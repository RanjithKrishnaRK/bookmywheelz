# BookMyWheelz: next steps after the SQL checks

The user confirmed the permission checks and SQL tests 0004/0005 passed in the
separate BookMyWheelz Test project. The specification has now been read. The next
step is a preview connected only to that test project, followed by two-account
booking tests. Main and production remain unchanged.

## Connect only this branch's preview to the test database

1. Open Vercel, select BookMyWheelz, then Settings > Environment Variables.
2. Add or override the following variables for Preview ONLY, scoped specifically
   to Git branch codex/stage-2a-audit. Use values from BookMyWheelz Test, not the
   production Supabase project. Preserve all Production values.

| Variable | Value from BookMyWheelz Test |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Public/publishable key (legacy anon also works) |
| SUPABASE_SERVICE_ROLE_KEY | Server secret key (legacy service_role also works) |

Find the URL in the project's Connect dialog; keys are under Settings > API Keys.
Enter keys directly into Vercel. Do not send secret keys, passwords, environment
files or screenshots showing keys in chat. No Razorpay key is needed for Stage 2A.

3. Open Deployments, choose the latest deployment for codex/stage-2a-audit and
   redeploy after saving variables. Confirm Environment is Preview. Do not promote
   to Production. If no deployment exists, create a Preview deployment using that
   Git branch. Use the latest published commit shown by this chat.
4. Copy its stable branch preview URL.
5. In BookMyWheelz Test > Authentication > URL Configuration, set Site URL to the
   preview origin. Add that exact origin followed by /auth/callback to Redirect
   URLs. Save. Keep production project's URL settings unchanged.
6. Open the preview and verify email sign-in. Send the preview URL and any error
   message to this chat; do not send credentials. Supabase's default mail service
   may restrict recipient addresses; if it rejects email delivery, configure test
   SMTP or report that specific error instead of weakening authentication.

Official references:
- https://vercel.com/docs/environment-variables/manage-across-environments
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/auth/redirect-urls

## Two-account acceptance checks after preview login works

1. Sign in with an owner test account and list a test car.
2. In the TEST project's Table Editor, approve only that test car by changing its
   status from pending to approved. Verify its owner and title before saving.
3. Use a separate browser profile for a renter test account.
4. With instant booking off, request future dates. Verify the owner's requests
   page shows the request and payout. Accept it; verify the renter sees Accepted.
5. Try the same held dates from another renter; expect an availability conflict.
   A booking ending exactly when another starts should be allowed.
6. Test declining a different request. Verify both screens update correctly.
7. On My cars, enable instant booking and request a different free range as renter.
   It should be accepted without an owner response. Disable it and verify the next
   new request waits for owner approval. Existing bookings must keep their status.
8. Block free dates from Manage availability. A renter must not be able to book
   them. Remove the block and retry. Blocking an accepted booking must fail.
9. Verify own-car booking is refused and an unrelated user cannot manage the car.
10. Verify expiry recovery and the complete SQL/concurrency suite before considering
    Stage 2A acceptance. Automated component tests are not a substitute for this.

Payments remain unavailable. Part 2B starts with Razorpay test mode only after the
booking flow is accepted. The specification also calls for a calendar interface;
the current owner screen provides date blocks as inputs plus a list, not a month grid.
