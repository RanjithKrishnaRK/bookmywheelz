-- Scratch PostgreSQL only. Apply local_stubs.sql and migrations 0001..0004 first.
-- Run with psql -v ON_ERROR_STOP=1; fixtures are rolled back.
begin;
insert into auth.users(id) values
  ('00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-0000000000b4');
insert into cars(id, owner_id, title, make, model, year, car_type, fuel, seats, transmission, city, price_per_day, status)
values ('00000000-0000-0000-0000-00000000ca04', '00000000-0000-0000-0000-0000000000a4', 'Expiry test', 'm', 'm', 2020, 'sedan', 'petrol', 5, 'manual', 'x', 1000, 'approved');
insert into bookings(id, car_id, renter_id, owner_id, start_at, end_at, status, price_paise, expires_at) values
  ('00000000-0000-0000-0000-0000000b0041', '00000000-0000-0000-0000-00000000ca04', '00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a4', now() + interval '2 days', now() + interval '3 days', 'approved', 100000, now() - interval '1 second'),
  ('00000000-0000-0000-0000-0000000b0042', '00000000-0000-0000-0000-00000000ca04', '00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a4', now() - interval '1 hour', now() + interval '1 day', 'requested', 100000, now() + interval '12 hours'),
  ('00000000-0000-0000-0000-0000000b0043', '00000000-0000-0000-0000-00000000ca04', '00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a4', now() + interval '4 days', now() + interval '5 days', 'requested', 100000, now() + interval '12 hours');
do $$ begin
  if exists (select 1 from car_unavailable_ranges('00000000-0000-0000-0000-00000000ca04')) then
    raise exception 'expired unpaid hold leaked into date picker';
  end if;
  if (select expires_at > start_at from bookings where id = '00000000-0000-0000-0000-0000000b0042') then
    raise exception 'deadline was not capped at pickup';
  end if;
  if expire_stale_bookings() <> 2 then raise exception 'expected two expired bookings'; end if;
end $$;
update cars set status = 'paused' where id = '00000000-0000-0000-0000-00000000ca04';
do $$ begin
  begin
    update bookings set status = 'approved' where id = '00000000-0000-0000-0000-0000000b0043';
    raise exception 'approval succeeded for paused listing';
  exception when check_violation then null;
  end;
end $$;
rollback;
