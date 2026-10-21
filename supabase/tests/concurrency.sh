#!/usr/bin/env bash
# Race test for 0002: two REAL concurrent sessions fight over the same car/dates. A rollback-only SQL
# script cannot test this, because concurrency needs two committed-or-in-flight transactions.
# LOCAL/SCRATCH DB ONLY (it commits fixture rows, then deletes them). Usage: ./concurrency.sh <db_name>
set -u
DB=${1:?usage: concurrency.sh <scratch_db_name>}
P="psql -q -At -d $DB -v ON_ERROR_STOP=1"
CAR=00000000-0000-0000-0000-00000000cc01; OWN=00000000-0000-0000-0000-0000000000a9; REN=00000000-0000-0000-0000-0000000000b9
$P -c "insert into auth.users(id,email) values ('$OWN','o@race'),('$REN','r@race') on conflict do nothing;
       insert into cars(id,owner_id,title,make,model,year,car_type,fuel,seats,transmission,city,price_per_day,status)
       values ('$CAR','$OWN','Race car','m','m',2020,'sedan','petrol',5,'manual','x',1000,'approved') on conflict do nothing;"
INS="insert into bookings(car_id,renter_id,owner_id,start_at,end_at,status,price_paise) values ('$CAR','$REN','$OWN','2031-01-01 10:00+00','2031-01-04 10:00+00','confirmed',1)"
BLK="insert into availability_blocks(car_id,start_at,end_at) values ('$CAR','2031-01-02 10:00+00','2031-01-03 10:00+00')"
fail=0
check(){ # $1 label, $2 output file, $3 expected substring
  if grep -q "$3" "$2"; then echo "PASS: $1"; else echo "FAIL: $1 (output: $(cat "$2"))"; fail=1; fi; }

echo "--- Race 1: two booking inserts for identical dates. Exactly one must win."
( echo "begin; $INS; select pg_sleep(3); commit;" | $P >/tmp/r1a.out 2>&1; echo "exit=$?" >>/tmp/r1a.out ) &
sleep 1
( echo "begin; $INS; commit;" | $P >/tmp/r1b.out 2>&1; echo "exit=$?" >>/tmp/r1b.out ) &
wait
check "first session committed"                     /tmp/r1a.out "exit=0"
check "second session was rejected, not double-booked" /tmp/r1b.out "conflicting key value violates exclusion constraint"
n=$($P -c "select count(*) from bookings where car_id='$CAR'"); [ "$n" = "1" ] && echo "PASS: exactly 1 booking stored" || { echo "FAIL: $n bookings stored"; fail=1; }

$P -c "delete from bookings where car_id='$CAR'"
echo "--- Race 2: a booking and an owner block written at the same instant (different tables). One must lose."
( echo "begin; $INS; select pg_sleep(3); commit;" | $P >/tmp/r2a.out 2>&1; echo "exit=$?" >>/tmp/r2a.out ) &
sleep 1
( echo "begin; $BLK; commit;" | $P >/tmp/r2b.out 2>&1; echo "exit=$?" >>/tmp/r2b.out ) &
wait
check "booking committed"                           /tmp/r2a.out "exit=0"
check "block was rejected (advisory lock closed the gap)" /tmp/r2b.out "overlap an existing booking"
n=$($P -c "select count(*) from availability_blocks where car_id='$CAR'"); [ "$n" = "0" ] && echo "PASS: no block stored over the booking" || { echo "FAIL: $n blocks stored"; fail=1; }

$P -c "delete from bookings where car_id='$CAR'; delete from availability_blocks where car_id='$CAR'; delete from cars where id='$CAR'; delete from auth.users where id in ('$OWN','$REN');"
[ $fail = 0 ] && echo "ALL CONCURRENCY CHECKS PASSED" || { echo "CONCURRENCY CHECKS FAILED"; exit 1; }
