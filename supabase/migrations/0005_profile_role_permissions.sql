-- The own-profile UPDATE policy limits rows, not columns. A browser must not be
-- able to promote its own profile to admin through the public database API.
revoke update on profiles from anon, authenticated;
grant update (full_name, phone) on profiles to authenticated;
