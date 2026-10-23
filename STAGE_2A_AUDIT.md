# Stage 2A audit — 23 October 2026

Repository: RanjithKrishnaRK/bookmywheelz. Audited base: `e7b8daa` on main.
Changes are isolated on `codex/stage-2a-audit`. No merge, deployment, database
migration execution, production data change or Razorpay action was performed.

## Fixed in this branch

| Finding | Evidence and change |
| --- | --- |
| Owners cannot respond through the site | The response API existed but there was no owner bookings page. Added owner-filtered requests, payout display, accept/decline actions, expired-action suppression, and retry/error handling. Linked from the header. |
| Manage availability leads to a missing page | BookingWidget linked to a nonexistent route. Added owner car list and per-car availability page, using existing RLS-protected block insert/delete policies. Protected booking conflicts remain enforced by database triggers. |
| Expired unpaid holds can prevent renters submitting | Public unavailable-ranges RPC included overdue approvals; the browser disabled submit before the API could sweep them. Migration 0004 excludes expired unpaid holds from public ranges. |
| Requests can be approved after pickup or after listing is paused | Existing response windows were independent of pickup, and the database checked listing approval only on insertion. New deadlines are capped at pickup; sweep expires unpaid bookings at pickup; response update also filters future pickup; trigger rechecks listing status on acceptance. |
| Valid quotes can overflow database columns | Pricing allowed 10 billion paise but booking columns are signed 32-bit integers. Pricing now caps amounts at 2,147,483,647 and validates the computed km allowance. Added regression coverage. |
| Users can change their own profile role | Stage 1 own-profile UPDATE policy restricts rows but permits editing the role column. Migration 0005 revokes browser table UPDATE and grants authenticated updates only to full_name and phone. Service-role administration remains available. |

Existing numbered migrations were preserved. Apply 0004 and 0005 only after
scratch-database validation and a review of the target project's actual grants.

## Verification

- Locked dependencies installed with lifecycle scripts disabled.
- 189 Vitest tests pass across 10 files, including new owner response and block-management tests and monetary overflow regression.
- Production build passes on Next.js 16.4.2, including TypeScript and prerendering.
  Build used `http://127.0.0.1:54321` and a dummy public key; no service key was supplied.
  This proves build compatibility, not live Supabase connectivity.
- ESLint completes with zero errors and two existing next/no-img-element warnings
  in search and car detail pages. Diff whitespace checks pass.
- SQL regression scripts were added for expiry, paused-listing acceptance and
  profile role permissions. They have **not been executed**: no PostgreSQL,
  psql or Docker runtime was available. Existing SQL and concurrency suites were
  also inspected but not executed.
- Owner UI tests use mocked Supabase and fetch responses; they do not prove
  deployed RLS enforcement or a real two-account booking flow.

## Migration and RLS review

- 0001: public reads approved cars/photos; owners create pending cars and edit
  their own cars subject to status checks. Profile read/update is scoped to self;
  column-level role protection was missing and is addressed in 0005. Public car
  photo storage is intentional in this schema.
- 0002: bookings SELECT is restricted to renter/owner. Browser writes to bookings
  and settings are revoked. Owner blocks use ownership checks. Server pricing,
  exclusion constraints and per-car advisory-lock triggers protect held ranges;
  half-open ranges allow back-to-back trips. Internal trigger/expiry RPC execution
  is revoked from browser roles. Public ranges expose dates rather than identities.
- 0003: audit log has RLS with no browser policies, revoked privileges and
  append-only update/delete/truncate triggers.
- 0004 preserves those boundaries and explicitly grants the internal sweep to
  service_role; 0005 restricts profile contact-field updates.

These are source-level conclusions. The deployed migration history, grants,
policies, function ownership, data consistency and scheduler configuration could
not be inspected without Supabase access.

## Remaining limitations and work

1. The referenced chat returned no specification attachment. The supplied follow-up
   link points to the same repository, which has README/SETUP but no full BookMyWheelz
   specification. Full Stage 2A specification compliance remains unverified.
2. No Supabase admin access or test accounts were supplied. Scratch migration/RLS
   tests, concurrency tests and two-account end-to-end checks remain required.
3. Request rate limits and duplicate prevention are separate count/check/insert
   operations, so concurrent requests can bypass them. Held-booking exclusion
   protection still applies. Atomic request creation is follow-up hardening.
4. Audit writes are best effort after booking mutations; expiry sweeps do not
   append audit rows. A transactional database audit design is needed before
   payment-affecting operations are introduced.
5. Expiry is opportunistic on booking API calls; no scheduled sweep was found.
   The picker now hides stale holds, but adding owner blocks can still conflict
   with an unswept expired holding row. A server-owned scheduled sweep needs setup.
6. Instant booking exists in schema/API but owners still have no UI to opt in.
   No payment capture, refund or payout workflow was added; payment is explicitly
   shown as unavailable in the UI. Hourly pricing and delivery fees remain deferred.
7. Dependency audit reports three dev-tool vulnerabilities (one moderate, two
   critical package entries) involving Vitest/@vitest/mocker/tinypool. Reported
   remediation requires a major Vitest upgrade; package versions were preserved
   to keep this booking patch focused. No production dependency advisory was reported.
8. The historical conversation contains an exposed GitHub credential. It was not
   used or copied into the repository. Revoke it if it is still active.

## Before rollout

Use a disposable database for local_stubs.sql, migrations 0001–0005 and all SQL
tests with ON_ERROR_STOP; run concurrency.sh with the same scratch database.
Validate renter, owner and unrelated-user sessions against real Supabase RLS,
including direct attempts to change profile role, booking amounts and another
owner's availability. Verify expired-hold picker recovery, paused-car approval
rejection and overlapping approvals. Confirm existing profile editors only use
allowed contact fields. Back up and review the target database before applying
new migrations. Keep this PR unmerged until those checks are complete.

## Specification follow-up — 23 October 2026

The complete 14-page PDF has now been reviewed. It defines Part 2A as availability,
booking requests, owner responses, instant booking, expiry, overlap protection,
owner requests and renter bookings pages. Parts 2B and 2C cover payments/deposits
and wallets/withdrawals respectively. The earlier missing-specification limitation
is resolved for this review.

The user reports all five permission checks and both new SQL regression scripts
passed in BookMyWheelz Test. This is user-reported remote validation, not a direct
inspection of that database. The complete overlap/concurrency suite and real
owner/renter browser flow remain unverified.

Added an owner instant-book toggle at /owner/cars with an authenticated server
endpoint, strict input validation, atomic owner filtering, audit recording and a
30-change/hour best-effort rate limit based on audit history. Only instant_book is
updated, so listing moderation state and existing bookings are preserved. No new
migration is required. Auditing/rate-limit concurrency limitations still apply.

Validation now passes 200 tests across 12 files. Production build passes with local
placeholder Supabase values; lint has zero errors and the same two existing image
warnings. The test configuration now includes route *.test.ts files.

The owner date-block screen uses datetime inputs and a block list; a month-grid
calendar is not implemented. Delivery pricing remains zero until a trusted
owner-configured delivery source exists. Stage 2A is not declared fully accepted:
preview owner/renter checks, the full database race suite and these product gaps
remain. Do not start real payment operations during this verification.
