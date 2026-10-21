-- Tests for 0002_bookings.sql. Run against a LOCAL/SCRATCH database only:
--   psql -v ON_ERROR_STOP=1 -d <scratch_db> -f supabase/tests/local_stubs.sql        (plain Postgres only)
--   psql -v ON_ERROR_STOP=1 -d <scratch_db> -f supabase/migrations/0001_stage1.sql
--   psql -v ON_ERROR_STOP=1 -d <scratch_db> -f supabase/migrations/0002_bookings.sql
--   psql -v ON_ERROR_STOP=1 -d <scratch_db> -f supabase/tests/0002_bookings.test.sql
-- Everything runs inside one transaction that is ROLLED BACK at the end, so it leaves no data behind.
-- Any failed expectation raises an exception and stops the script with a non-zero exit code.
begin;

create function pg_temp.passes(q text, label text, uid uuid default null, r text default null) returns void language plpgsql as $$
begin
  if uid is not null then perform set_config('request.jwt.claim.sub', uid::text, true); end if;
  if r is not null then execute 'set local role ' || r; end if;
  begin execute q; exception when others then
    reset role; raise exception 'FAIL: % (expected success, got % %)', label, sqlstate, sqlerrm;
  end;
  reset role; raise notice 'PASS: %', label;
end $$;

create function pg_temp.fails_with(q text, code text, label text, uid uuid default null, r text default null) returns void language plpgsql as $$
declare v_state text;
begin
  if uid is not null then perform set_config('request.jwt.claim.sub', uid::text, true); end if;
  if r is not null then execute 'set local role ' || r; end if;
  begin execute q; exception when others then v_state := sqlstate; end;
  reset role;
  if v_state is null then raise exception 'FAIL: % (expected error %, but it succeeded)', label, code; end if;
  if v_state <> code then raise exception 'FAIL: % (expected error %, got %)', label, code, v_state; end if;
  raise notice 'PASS: %', label;
end $$;

create function pg_temp.expect_count(q text, want bigint, label text, uid uuid default null, r text default null) returns void language plpgsql as $$
declare got bigint;
begin
  if uid is not null then perform set_config('request.jwt.claim.sub', uid::text, true); end if;
  if r is not null then execute 'set local role ' || r; end if;
  execute q into got;
  reset role;
  if got is distinct from want then raise exception 'FAIL: % (expected %, got %)', label, want, got; end if;
  raise notice 'PASS: %', label;
end $$;

-- Fixtures -------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test'),
  ('00000000-0000-0000-0000-0000000000b1', 'renter@test'),
  ('00000000-0000-0000-0000-0000000000c1', 'other@test');   -- profiles are created by the signup trigger
insert into cars (id, owner_id, title, make, model, year, car_type, fuel, seats, transmission, city, price_per_day, status) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-0000000000a1', 'Car A', 'm', 'm', 2020, 'sedan', 'petrol', 5, 'manual', 'x', 1000, 'approved'),
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-0000000000a1', 'Car B', 'm', 'm', 2020, 'sedan', 'petrol', 5, 'manual', 'x', 1000, 'approved'),
  ('00000000-0000-0000-0000-00000000ca03', '00000000-0000-0000-0000-0000000000a1', 'Car pending', 'm', 'm', 2020, 'sedan', 'petrol', 5, 'manual', 'x', 1000, 'pending');

-- Helper to keep the booking inserts below readable. d(n) = n days from a fixed future anchor.
create function pg_temp.d(n int) returns text language sql as $$ select (timestamptz '2030-01-01 10:00+00' + make_interval(days => n))::text $$;
create function pg_temp.bk(id int, car text, s int, e int, status text default 'requested', who text default 'b1', own text default 'a1') returns text language sql as $$
  select format($f$insert into bookings (id, car_id, renter_id, owner_id, start_at, end_at, status, price_paise)
    values ('00000000-0000-0000-0000-0000000b%s', '00000000-0000-0000-0000-00000000%s',
            '00000000-0000-0000-0000-0000000000%s', '00000000-0000-0000-0000-0000000000%s', %L, %L, %L, 100000)$f$,
    lpad(id::text, 4, '0'), car, who, own, pg_temp.d(s), pg_temp.d(e), status)
$$;

-- Overlap protection ---------------------------------------------------------------------------
select pg_temp.passes(pg_temp.bk(1, 'ca01', 0, 3), 'request on an approved car is accepted');
select pg_temp.passes($$update bookings set status='approved' where id='00000000-0000-0000-0000-0000000b0001'$$, 'approving it holds the car');
select pg_temp.passes(pg_temp.bk(2, 'ca01', 1, 3), 'a second REQUEST over held dates is allowed (requests do not hold the car)', null, null);
select pg_temp.fails_with($$update bookings set status='approved' where id='00000000-0000-0000-0000-0000000b0002'$$, '23P01', 'approving an overlapping booking is rejected (exclusion constraint)');
select pg_temp.fails_with(pg_temp.bk(3, 'ca01', 2, 5, 'payment_pending'), '23P01', 'instant-book style insert over held dates is rejected');
select pg_temp.fails_with(pg_temp.bk(4, 'ca01', -2, 1, 'confirmed'), '23P01', 'overlap at the START edge is rejected');
select pg_temp.fails_with(pg_temp.bk(5, 'ca01', 0, 3, 'confirmed'), '23P01', 'identical dates are rejected');
select pg_temp.passes(pg_temp.bk(6, 'ca01', 3, 5, 'confirmed'), 'back-to-back (return time = next pickup time) is allowed');
select pg_temp.passes(pg_temp.bk(7, 'ca02', 0, 3, 'confirmed'), 'same dates on a DIFFERENT car are allowed');
select pg_temp.passes($$update bookings set status='cancelled' where id='00000000-0000-0000-0000-0000000b0001'$$, 'cancelling frees the dates');
select pg_temp.passes($$update bookings set status='approved' where id='00000000-0000-0000-0000-0000000b0002'$$, 'the previously blocked booking can now be approved');

-- Owner blocks vs bookings (cross-table triggers) ------------------------------------------------
select pg_temp.fails_with($$insert into availability_blocks (car_id, start_at, end_at) values ('00000000-0000-0000-0000-00000000ca01', '2030-01-03 10:00+00', '2030-01-04 10:00+00')$$,
  '23P01', 'owner cannot block over an approved booking');
select pg_temp.passes($$insert into availability_blocks (car_id, start_at, end_at) values ('00000000-0000-0000-0000-00000000ca01', '2030-02-01 10:00+00', '2030-02-05 10:00+00')$$, 'owner can block free dates');
select pg_temp.passes(pg_temp.bk(8, 'ca01', 31, 33, 'requested'), 'a REQUEST over a block is stored (it cannot be approved)');
select pg_temp.fails_with($$update bookings set status='approved' where id='00000000-0000-0000-0000-0000000b0008'$$, '23P01', 'approving a booking over an owner block is rejected');
select pg_temp.fails_with(pg_temp.bk(9, 'ca01', 32, 34, 'confirmed'), '23P01', 'inserting a holding booking over an owner block is rejected');
select pg_temp.passes($$insert into availability_blocks (car_id, start_at, end_at) values ('00000000-0000-0000-0000-00000000ca01', '2030-02-05 10:00+00', '2030-02-06 10:00+00')$$, 'block that only touches an edge is allowed');

-- Booking integrity ----------------------------------------------------------------------------
select pg_temp.fails_with(pg_temp.bk(10, 'ca03', 40, 42), '23514', 'cannot book a car that is not approved');
select pg_temp.fails_with(pg_temp.bk(11, 'ca01', 40, 42, 'requested', 'b1', 'c1'), '23514', 'owner_id must match the car''s real owner');
select pg_temp.fails_with(pg_temp.bk(12, 'ca01', 40, 42, 'requested', 'a1', 'a1'), '23514', 'owner cannot rent their own car');
select pg_temp.fails_with(pg_temp.bk(13, 'ca01', 42, 40), '23514', 'end must be after start');
select pg_temp.fails_with(replace(pg_temp.bk(14, 'ca01', 40, 42), '100000)', '-5)'), '23514', 'negative money is rejected');
select pg_temp.fails_with(replace(pg_temp.bk(15, 'ca01', 40, 42), '''requested''', '''hacked'''), '23514', 'unknown status is rejected');

-- Expiry ---------------------------------------------------------------------------------------
select pg_temp.passes(pg_temp.bk(20, 'ca02', 50, 52, 'requested'), 'setup: stale request');
select pg_temp.passes(pg_temp.bk(21, 'ca02', 53, 55, 'payment_pending'), 'setup: stale unpaid approval (holds the car)');
select pg_temp.passes(pg_temp.bk(22, 'ca02', 56, 58, 'requested'), 'setup: request still within its window');
select pg_temp.passes(pg_temp.bk(23, 'ca02', 60, 62, 'confirmed'), 'setup: confirmed booking with no deadline');
update bookings set expires_at = now() - interval '1 minute' where id in ('00000000-0000-0000-0000-0000000b0020', '00000000-0000-0000-0000-0000000b0021', '00000000-0000-0000-0000-0000000b0023');
update bookings set expires_at = now() + interval '1 hour' where id = '00000000-0000-0000-0000-0000000b0022';
select pg_temp.expect_count('select expire_stale_bookings()', 2, 'expiry sweeps exactly the 2 overdue requested/payment_pending rows');
select pg_temp.expect_count($$select count(*) from bookings where id in ('00000000-0000-0000-0000-0000000b0022','00000000-0000-0000-0000-0000000b0023') and status in ('requested','confirmed')$$, 2, 'in-window request and confirmed booking are untouched');
select pg_temp.passes(pg_temp.bk(24, 'ca02', 53, 55, 'confirmed'), 'dates held by an expired unpaid approval are free again');

-- Permissions: what a signed-in browser can and cannot do -----------------------------------------
select pg_temp.fails_with(pg_temp.bk(30, 'ca01', 70, 72), '42501', 'browser role cannot insert bookings directly', '00000000-0000-0000-0000-0000000000b1', 'authenticated');
-- Defence in depth: RLS alone already blocks the insert above, and gives the SAME error code, so that check
-- cannot tell whether the REVOKE works. Simulate the mistake the REVOKE exists for (someone adds an
-- over-permissive policy later) and prove the table privileges still hold. DDL here rolls back with the test.
create policy tmp_oops_allow_all on bookings for insert to authenticated with check (true);
create policy tmp_oops_allow_all_upd on bookings for update to authenticated using (true) with check (true);
select pg_temp.fails_with(pg_temp.bk(31, 'ca01', 70, 72), '42501', 'even with a mistaken permissive INSERT policy, browsers still cannot insert (privileges hold)', '00000000-0000-0000-0000-0000000000b1', 'authenticated');
select pg_temp.fails_with($$update bookings set price_paise = 1 where true$$, '42501', 'even with a mistaken permissive UPDATE policy, browsers still cannot rewrite prices', '00000000-0000-0000-0000-0000000000b1', 'authenticated');
drop policy tmp_oops_allow_all on bookings;
drop policy tmp_oops_allow_all_upd on bookings;
select pg_temp.fails_with($$update bookings set price_paise = 1 where true$$, '42501', 'browser role cannot rewrite prices', '00000000-0000-0000-0000-0000000000b1', 'authenticated');
select pg_temp.fails_with($$delete from bookings where true$$, '42501', 'browser role cannot delete bookings', '00000000-0000-0000-0000-0000000000b1', 'authenticated');
select pg_temp.expect_count($$select count(*) from bookings$$, 0, 'a user who is neither renter nor owner sees ZERO bookings', '00000000-0000-0000-0000-0000000000c1', 'authenticated');
select pg_temp.expect_count($$select count(*) from bookings where renter_id <> auth.uid()$$, 0, 'the renter sees no one else''s bookings', '00000000-0000-0000-0000-0000000000b1', 'authenticated');
select pg_temp.expect_count($$select (count(*) > 0)::int from bookings$$, 1, 'the renter does see their own bookings', '00000000-0000-0000-0000-0000000000b1', 'authenticated');
select pg_temp.expect_count($$select (count(*) > 0)::int from bookings where owner_id = auth.uid()$$, 1, 'the car owner sees bookings for their cars', '00000000-0000-0000-0000-0000000000a1', 'authenticated');
select pg_temp.fails_with($$select expire_stale_bookings()$$, '42501', 'browser role cannot call expire_stale_bookings()', '00000000-0000-0000-0000-0000000000b1', 'authenticated');
select pg_temp.fails_with($$update platform_settings set fee_percent = 0$$, '42501', 'browser role cannot change the platform fee', '00000000-0000-0000-0000-0000000000a1', 'authenticated');
select pg_temp.fails_with($$insert into platform_settings (id) values (false)$$, '42501', 'browser role cannot insert settings', '00000000-0000-0000-0000-0000000000a1', 'authenticated');
select pg_temp.expect_count($$select count(*) from platform_settings$$, 1, 'anyone (anon) can read the settings row', null, 'anon');
select pg_temp.fails_with($$insert into platform_settings (id, fee_percent) values (false, 1)$$, '23514', 'platform_settings can never hold a second row');

-- availability_blocks permissions
select pg_temp.passes($$insert into availability_blocks (car_id, start_at, end_at) values ('00000000-0000-0000-0000-00000000ca02', '2030-03-01 10:00+00', '2030-03-02 10:00+00')$$, 'car owner can add a block via the browser role', '00000000-0000-0000-0000-0000000000a1', 'authenticated');
select pg_temp.fails_with($$insert into availability_blocks (car_id, start_at, end_at) values ('00000000-0000-0000-0000-00000000ca02', '2030-03-10 10:00+00', '2030-03-11 10:00+00')$$, '42501', 'a different user cannot block someone else''s car', '00000000-0000-0000-0000-0000000000c1', 'authenticated');
select pg_temp.fails_with($$update availability_blocks set end_at = end_at + interval '1 day'$$, '42501', 'blocks cannot be updated by the browser role', '00000000-0000-0000-0000-0000000000a1', 'authenticated');
select pg_temp.expect_count($$select count(*) from availability_blocks$$, 0, 'a non-owner cannot read blocks', '00000000-0000-0000-0000-0000000000c1', 'authenticated');

-- Public date picker function --------------------------------------------------------------------
-- Car A holds: booking 2 (approved), booking 6 (confirmed) + 2 owner blocks = 4 ranges. NOT included:
-- booking 1 (cancelled), booking 8 (only requested). Fixtures are in 2030, so they count as future.
select pg_temp.expect_count($$select count(*) from car_unavailable_ranges('00000000-0000-0000-0000-00000000ca01')$$, 4, 'anon sees exactly the held ranges + blocks (not cancelled or merely-requested bookings)', null, 'anon');
select pg_temp.expect_count($$select count(*) from car_unavailable_ranges('00000000-0000-0000-0000-00000000ca03')$$, 0, 'nothing is revealed for a car that is not approved', null, 'anon');
select pg_temp.expect_count($$select count(*) from pg_proc p, unnest(p.proargnames) n where p.proname = 'car_unavailable_ranges' and n in ('renter_id','owner_id','price_paise')$$, 0, 'the function exposes no identity or money columns');

rollback;
