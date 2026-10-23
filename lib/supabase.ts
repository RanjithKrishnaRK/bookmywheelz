import { createClient } from '@supabase/supabase-js';

// Cookie-less anon client for PUBLIC reads in server components (search, car detail).
// It never carries a user session, so those pages stay independent of request cookies.
// For anything user-specific use lib/supabase/browser.ts (client) or lib/supabase/server.ts (server).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export type Car = {
  id: string; owner_id: string; instant_book: boolean; title: string; make: string; model: string; year: number;
  car_type: string; fuel: string; seats: number; transmission: string;
  city: string; area: string | null; description: string | null;
  price_per_day: number; km_limit_per_day: number | null; security_deposit: number;
  min_rental_days: number; min_driver_age: number; fuel_policy: string;
  airport_pickup: boolean; pet_friendly: boolean; delivery_available: boolean;
  car_photos?: { url: string; sort: number }[];
};

export const rupees = (n: number) => '₹' + n.toLocaleString('en-IN');
