-- Scratch PostgreSQL only; apply all migrations first. Run with ON_ERROR_STOP.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000a5');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a5', true);
update profiles set full_name = 'Owner test', phone = '1234567890' where id = auth.uid();
do $$ begin
  if not exists (select 1 from profiles where id = auth.uid() and full_name = 'Owner test') then
    raise exception 'profile contact update failed';
  end if;
  begin
    update profiles set role = 'admin' where id = auth.uid();
    raise exception 'browser changed its own role';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
