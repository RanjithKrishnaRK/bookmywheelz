# BookMyWheelz Stage 1: setup

1. Create a free project at supabase.com. Open SQL Editor, paste `supabase/migrations/0001_stage1.sql`, click Run.
2. Supabase > Project Settings > API: copy the Project URL and the anon public key.
3. In a terminal:
```
npx create-next-app@latest web --ts --app --no-tailwind --eslint --no-src-dir --import-alias "@/*"
cd web
npm i @supabase/supabase-js
```
4. Copy the `apps/web/app` and `apps/web/lib` folders from this download over `web/app` and `web/lib` (replace files when asked).
5. Copy `.env.example` to `.env.local` and fill in both values.
6. `npm run dev` and open http://localhost:3000
7. Test: Sign in (email link) > List your car > submit. Then approve it in Supabase SQL Editor:
```
update cars set status = 'approved' where status = 'pending';
```
Refresh /search and your car appears.
