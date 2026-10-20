-- Stage 1: profiles, cars (with rules), photos, RLS, storage
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text, phone text,
  role text not null default 'both' check (role in ('renter','owner','both','admin')),
  created_at timestamptz default now()
);
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles(id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create table cars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null, make text not null, model text not null, year int not null,
  car_type text not null check (car_type in ('hatchback','sedan','suv','muv','luxury')),
  fuel text not null check (fuel in ('petrol','diesel','cng','electric')),
  seats int not null check (seats between 2 and 12),
  transmission text not null check (transmission in ('manual','automatic')),
  city text not null, area text, description text,
  price_per_day int not null check (price_per_day > 0),      -- rupees
  price_per_hour int check (price_per_hour > 0),
  -- owner conditions (kept on cars for Stage 1; can split into car_rules later)
  km_limit_per_day int,                                       -- null = unlimited
  security_deposit int not null default 0,                    -- 0 = no deposit
  min_rental_days int not null default 1,
  min_driver_age int not null default 21,
  fuel_policy text not null default 'full-to-full',
  airport_pickup boolean not null default false,
  pet_friendly boolean not null default false,
  delivery_available boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paused')),
  created_at timestamptz default now()
);
create index on cars (city, status);
create table car_photos (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references cars(id) on delete cascade,
  url text not null, sort int default 0
);

alter table profiles enable row level security;
alter table cars enable row level security;
alter table car_photos enable row level security;
create policy "own profile read" on profiles for select using (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);
create policy "public sees approved cars" on cars for select using (status = 'approved' or owner_id = auth.uid());
create policy "owner inserts car" on cars for insert with check (owner_id = auth.uid() and status = 'pending');
create policy "owner edits own car" on cars for update using (owner_id = auth.uid()) with check (owner_id = auth.uid() and status in ('pending','paused'));
create policy "photos visible with car" on car_photos for select using (exists (select 1 from cars c where c.id = car_id and (c.status='approved' or c.owner_id = auth.uid())));
create policy "owner adds photos" on car_photos for insert with check (exists (select 1 from cars c where c.id = car_id and c.owner_id = auth.uid()));

insert into storage.buckets (id, name, public) values ('car-photos','car-photos',true) on conflict do nothing;
create policy "anyone views car photos" on storage.objects for select using (bucket_id = 'car-photos');
create policy "signed-in upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'car-photos' and (storage.foldername(name))[1] = auth.uid()::text);
