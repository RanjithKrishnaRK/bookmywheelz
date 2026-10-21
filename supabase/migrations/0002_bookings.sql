-- Stage 2A: instant-book flag, platform_settings, availability_blocks, bookings (+ overlap protection)
-- Conventions: new money columns are integer PAISE (1 rupee = 100 paise). cars.price_per_day stays in
-- rupees from Stage 1, so the server converts (rupees * 100) when it creates a booking.
-- Bookings are written ONLY by the server (service role key). Browsers get read access, never write.

create extension if not exists btree_gist;  -- lets a GiST exclusion constraint compare uuid with "="

-- Owner opt-in for auto-accept (spec 9.1). Off by default: owners must choose to skip manual approval.
alter table cars add column instant_book boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- platform_settings: ONE row, editable by admin without a code deploy (spec 7.2)
-- ---------------------------------------------------------------------------------------------
create table platform_settings (
  id boolean primary key default true check (id),   -- check (id) + default true = at most one row, ever
  fee_percent numeric(5,2) not null default 15 check (fee_percent between 0 and 100),
  fee_charged_to text not null default 'owner' check (fee_charged_to in ('owner','renter','split')),
  renter_service_fee_paise int not null default 0 check (renter_service_fee_paise >= 0),
  hold_hours_after_trip int not null default 24 check (hold_hours_after_trip >= 0),
  owner_response_hours int not null default 12 check (owner_response_hours > 0),     -- request expiry
  payment_window_minutes int not null default 30 check (payment_window_minutes > 0), -- time to pay after approval
  full_refund_hours_before int not null default 48 check (full_refund_hours_before >= 0),
  partial_refund_percent int not null default 50 check (partial_refund_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into platform_settings default values;

-- ---------------------------------------------------------------------------------------------
-- availability_blocks: dates an owner takes their own car off the market
-- ---------------------------------------------------------------------------------------------
create table availability_blocks (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references cars(id) on delete cascade,
  start_at timestamptz not null,   -- spec calls these "start"/"end"; both are reserved words in SQL
  end_at timestamptz not null,
  -- Spec allows 'booked' too, but bookings already hold the car through their own exclusion constraint,
  -- so a 'booked' block would be a second, drift-prone copy of the same fact. Stage 2 only writes
  -- owner_blocked; the value stays allowed so the spec's schema is honoured.
  reason text not null default 'owner_blocked' check (reason in ('owner_blocked','booked')),
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index on availability_blocks (car_id, start_at);

-- ---------------------------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------------------------
create table bookings (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references cars(id) on delete restrict,        -- never silently delete a car that has bookings
  renter_id uuid not null references profiles(id) on delete restrict,
  owner_id uuid not null references profiles(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'requested' check (status in (
    'requested','approved','rejected','expired','payment_pending','confirmed',
    'active','returned','completed','cancelled','disputed')),
  instant_book boolean not null default false,
  -- All money is computed by the server and stored here as a snapshot: if platform_settings changes
  -- later, an existing booking must not change price.
  price_paise int not null check (price_paise >= 0),
  delivery_fee_paise int not null default 0 check (delivery_fee_paise >= 0),
  renter_service_fee_paise int not null default 0 check (renter_service_fee_paise >= 0),
  platform_fee_paise int not null default 0 check (platform_fee_paise >= 0),
  owner_payout_paise int not null default 0 check (owner_payout_paise >= 0),
  deposit_paise int not null default 0 check (deposit_paise >= 0),
  km_limit int,                       -- snapshot of the car's limit at booking time; null = unlimited
  expires_at timestamptz,             -- deadline while requested / approved / payment_pending, else null
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (renter_id <> owner_id)       -- you cannot rent your own car (wash-trading / fee-farming guard)
);
create index on bookings (car_id, start_at);
create index on bookings (renter_id, created_at desc);
create index on bookings (owner_id, created_at desc);
create index on bookings (expires_at) where status in ('requested','approved','payment_pending');

-- Statuses that HOLD the car (it cannot be booked by someone else for those dates):
--   approved, payment_pending, confirmed, active, returned, disputed.
-- 'requested' deliberately does NOT hold: otherwise one pending request would lock the car for the
-- owner-response window and anyone could block a popular car by spamming requests. The overlap check
-- bites at approval time instead (the second approval fails with an exclusion violation).
-- Range is half-open '[)' so a return at 10:00 and the next pickup at 10:00 do not conflict.
-- This constraint is the real guarantee: it holds even under simultaneous requests, because
-- Postgres checks it atomically at insert/update time. Application-level checks are only a UX nicety.
alter table bookings add constraint bookings_no_overlap exclude using gist (
  car_id with =,
  tstzrange(start_at, end_at, '[)') with &&
) where (status in ('approved','payment_pending','confirmed','active','returned','disputed'));

-- ---------------------------------------------------------------------------------------------
-- Cross-table protection: a block and a booking can't overlap. An exclusion constraint cannot span
-- two tables, so triggers do it. Both triggers take the same per-car advisory lock, which makes
-- "check, then insert" safe against a block and a booking being written at the same instant.
-- Violations raise SQLSTATE 23P01 (the same code the exclusion constraint uses), so the API can
-- treat "dates unavailable" identically whichever mechanism caught it.
-- ---------------------------------------------------------------------------------------------
create function bookings_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_status text;
  holding constant text[] := array['approved','payment_pending','confirmed','active','returned','disputed'];
begin
  perform pg_advisory_xact_lock(hashtextextended(new.car_id::text, 0));
  new.updated_at := now();

  select owner_id, status into v_owner, v_status from cars where id = new.car_id;
  -- Defence in depth: even though only the server writes here, never trust a passed-in owner_id.
  if v_owner is distinct from new.owner_id then
    raise exception 'booking owner does not match car owner' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_status <> 'approved' then raise exception 'car is not available for booking' using errcode = '23514'; end if;
  elsif old.status = new.status and old.start_at = new.start_at and old.end_at = new.end_at then
    return new;  -- nothing relevant changed: don't re-validate (e.g. a later owner block must not break a trip in progress)
  end if;

  if new.status = any(holding) and exists (
    select 1 from availability_blocks a
    where a.car_id = new.car_id and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'car is blocked by the owner for these dates' using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger bookings_guard_trg before insert or update on bookings
  for each row execute function bookings_guard();

create function availability_blocks_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.car_id::text, 0));
  -- security definer so this sees ALL bookings, not just the ones RLS lets the owner read; an owner
  -- must not be able to block over a confirmed trip, and must not learn who booked via the error text.
  if exists (
    select 1 from bookings b
    where b.car_id = new.car_id
      and b.status in ('approved','payment_pending','confirmed','active','returned','disputed')
      and tstzrange(b.start_at, b.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'these dates overlap an existing booking' using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger availability_blocks_guard_trg before insert or update on availability_blocks
  for each row execute function availability_blocks_guard();

-- ---------------------------------------------------------------------------------------------
-- Expiry. A pending request or unpaid approval must not sit forever, and (for approved/payment_pending)
-- it HOLDS the car. A constraint can't call now(), so expiry is an explicit sweep. The API calls this
-- before every availability check and a scheduled job should also call it. Server-only (see grants).
-- ---------------------------------------------------------------------------------------------
create function expire_stale_bookings() returns int language sql security definer set search_path = public as $$
  with u as (
    update bookings set status = 'expired'
    where status in ('requested','approved','payment_pending') and expires_at is not null and expires_at < now()
    returning 1)
  select count(*)::int from u
$$;

-- ---------------------------------------------------------------------------------------------
-- What the renter's date picker needs: WHEN a car is unavailable, never WHO booked it.
-- Renters cannot read other people's bookings (RLS below), so this security definer function exposes
-- only date ranges, only for approved cars, only future ones.
-- ---------------------------------------------------------------------------------------------
create function car_unavailable_ranges(p_car_id uuid) returns table (start_at timestamptz, end_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.start_at, b.end_at from bookings b
  where b.car_id = p_car_id and b.end_at > now()
    and b.status in ('approved','payment_pending','confirmed','active','returned','disputed')
    and exists (select 1 from cars c where c.id = p_car_id and c.status = 'approved')
  union all
  select a.start_at, a.end_at from availability_blocks a
  where a.car_id = p_car_id and a.end_at > now()
    and exists (select 1 from cars c where c.id = p_car_id and c.status = 'approved')
$$;

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------
alter table platform_settings enable row level security;
alter table availability_blocks enable row level security;
alter table bookings enable row level security;

-- Fee/policy numbers are not secret: the renter sees the breakdown at checkout anyway.
create policy "anyone reads settings" on platform_settings for select using (true);

create policy "owner reads own blocks" on availability_blocks for select
  using (exists (select 1 from cars c where c.id = car_id and c.owner_id = auth.uid()));
create policy "owner adds own blocks" on availability_blocks for insert
  with check (reason = 'owner_blocked' and exists (select 1 from cars c where c.id = car_id and c.owner_id = auth.uid()));
create policy "owner removes own blocks" on availability_blocks for delete
  using (exists (select 1 from cars c where c.id = car_id and c.owner_id = auth.uid()));

-- Only the two parties see a booking. There is intentionally NO insert/update/delete policy.
create policy "parties read booking" on bookings for select
  using (renter_id = auth.uid() or owner_id = auth.uid());

-- Belt and braces: if someone later adds a permissive policy by mistake, the table privileges still
-- stop browser roles from writing money rows. The service role (server) is unaffected.
revoke insert, update, delete, truncate on bookings from anon, authenticated;
revoke insert, update, delete, truncate on platform_settings from anon, authenticated;
revoke update on availability_blocks from anon, authenticated;  -- to change dates: delete and re-add

-- Internal functions: server only. Postgres grants EXECUTE to everyone by default, which would let any
-- signed-in browser call expire_stale_bookings() or the triggers directly.
revoke execute on function expire_stale_bookings() from public, anon, authenticated;
revoke execute on function bookings_guard() from public, anon, authenticated;
revoke execute on function availability_blocks_guard() from public, anon, authenticated;
revoke execute on function car_unavailable_ranges(uuid) from public;
grant execute on function car_unavailable_ranges(uuid) to anon, authenticated;
