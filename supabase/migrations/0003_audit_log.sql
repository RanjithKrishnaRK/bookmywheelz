-- Stage 2A: audit_log. Every money-affecting or admin action writes one row (spec section 13).
-- Written ONLY by the server (service role). Browsers cannot read or write it: RLS is on with no
-- policies, and table privileges are revoked as a second layer (same pattern as bookings).
create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id) on delete set null,   -- null = the system itself (e.g. a scheduled job)
  action text not null,                                       -- e.g. 'booking.create', 'booking.approve'
  entity text not null,                                       -- e.g. 'booking'
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log (entity, entity_id, created_at desc);
create index on audit_log (actor_id, created_at desc);

alter table audit_log enable row level security;
revoke all on audit_log from anon, authenticated;

-- Append-only. The service role bypasses RLS, so RLS alone cannot stop a buggy or compromised server from
-- editing history. A trigger can: it fires for every role. (A superuser could still drop it, which is why
-- the real defence is also restricting who holds database admin credentials.)
create function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_append_only();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_append_only();
