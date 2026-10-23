# BookMyWheelz: setup

## 1. Database (Supabase)
Create a project at supabase.com. In the SQL Editor run the files in `supabase/migrations/` **in order, one at a time**:

1. `0001_stage1.sql` (profiles, cars, photos, storage)
2. `0002_bookings.sql` (bookings, availability blocks, platform settings, double-booking protection)
3. `0003_audit_log.sql` (append-only audit trail)
4. `0004_booking_expiry.sql` (expired holds and pickup deadlines)
5. `0005_profile_role_permissions.sql` (prevent self-service role escalation)

Never edit a migration that has already been run; add a new numbered file instead.

If you signed in *before* running `0001`, your account has no profile row. Run once:
```sql
insert into profiles (id) select id from auth.users on conflict do nothing;
```

Then in Authentication > URL Configuration > Redirect URLs add `http://localhost:3000/auth/callback` and `https://<your-vercel-url>/auth/callback`.

## 2. Environment variables
Create `.env.local` (it is git-ignored; **never commit it**):

| Variable | Where it comes from | Exposed to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API > Project URL | yes (public by design) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page, `anon` `public` key | yes (public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, `service_role` key | **NO. Server only.** |

`SUPABASE_SERVICE_ROLE_KEY` bypasses all Row Level Security and is required by the booking API. Never put it in a
`NEXT_PUBLIC_` variable, never paste it into chat, code or screenshots, and rotate it if it ever leaks. Add the same three
variables in Vercel before deploying. Variables are baked in at build time: restart `npm run dev`, and redeploy on Vercel,
after changing them. If the service key is missing the booking API returns a generic `500 server_misconfigured`.

## 3. Run
```
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (pricing, validation, request guards)
npm run build      # run before every push
```

## 4. Try it
Sign in (email link) > List your car > submit. Approve it in the SQL Editor:
```sql
update cars set status = 'approved' where status = 'pending';
```
Your car appears on /search. To exercise the booking API you need a second account (you cannot book your own car).

## Database tests
`supabase/tests/` holds SQL and race tests for the bookings schema. They are for a **scratch local Postgres only**, never
a real project: see the header of each file.
