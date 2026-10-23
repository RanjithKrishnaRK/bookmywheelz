-- Keep expired unpaid holds out of the public date picker without granting
-- anonymous callers permission to mutate bookings or run the expiry sweep.
create or replace function car_unavailable_ranges(p_car_id uuid)
returns table (start_at timestamptz, end_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.start_at, b.end_at from bookings b
  where b.car_id = p_car_id and b.end_at > now()
    and b.status in ('approved','payment_pending','confirmed','active','returned','disputed')
    and (b.status not in ('approved','payment_pending')
      or ((b.expires_at is null or b.expires_at > now()) and b.start_at > now()))
    and exists (select 1 from cars c where c.id = p_car_id and c.status = 'approved')
  union all
  select a.start_at, a.end_at from availability_blocks a
  where a.car_id = p_car_id and a.end_at > now()
    and exists (select 1 from cars c where c.id = p_car_id and c.status = 'approved')
$$;

-- A request made shortly before pickup must not remain approvable after pickup.
create or replace function expire_stale_bookings() returns int
language sql security definer set search_path = public as $$
  with u as (
    update bookings set status = 'expired'
    where status in ('requested','approved','payment_pending')
      and ((expires_at is not null and expires_at <= now()) or start_at <= now())
    returning 1)
  select count(*)::int from u
$$;

revoke execute on function expire_stale_bookings() from public, anon, authenticated;
grant execute on function expire_stale_bookings() to service_role;
revoke execute on function car_unavailable_ranges(uuid) from public;
grant execute on function car_unavailable_ranges(uuid) to anon, authenticated;

-- Recheck listing approval when accepting an existing request, and cap each
-- unpaid deadline at pickup even when an older API server is still running.
create or replace function bookings_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_status text;
  holding constant text[] := array['approved','payment_pending','confirmed','active','returned','disputed'];
begin
  perform pg_advisory_xact_lock(hashtextextended(new.car_id::text, 0));
  new.updated_at := now();
  select owner_id, status into v_owner, v_status from cars where id = new.car_id;
  if v_owner is distinct from new.owner_id then
    raise exception 'booking owner does not match car owner' using errcode = '23514';
  end if;
  if new.status in ('requested','approved','payment_pending') and new.expires_at is not null then
    new.expires_at := least(new.expires_at, new.start_at);
  end if;
  if tg_op = 'INSERT' then
    if v_status <> 'approved' then raise exception 'car is not available for booking' using errcode = '23514'; end if;
  else
    if old.status = 'requested' and new.status in ('approved','payment_pending') then
      if v_status <> 'approved' or new.start_at <= now() or old.expires_at <= now() then
        raise exception 'request is no longer available for approval' using errcode = '23514';
      end if;
    end if;
    if old.car_id = new.car_id and old.status = new.status and old.start_at = new.start_at and old.end_at = new.end_at then
      return new;
    end if;
  end if;
  if new.status = any(holding) and exists (
    select 1 from availability_blocks a
    where a.car_id = new.car_id and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception 'car is blocked by the owner for these dates' using errcode = '23P01';
  end if;
  return new;
end $$;
revoke execute on function bookings_guard() from public, anon, authenticated;
