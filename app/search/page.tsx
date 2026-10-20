import Link from 'next/link';
import { supabase, rupees, type Car } from '@/lib/supabase';

type SP = { [k: string]: string | undefined };

export default async function Search({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  let q = supabase.from('cars').select('*, car_photos(url, sort)').eq('status', 'approved');
  if (sp.city) q = q.ilike('city', `%${sp.city.trim()}%`);
  if (sp.car_type) q = q.eq('car_type', sp.car_type);
  if (sp.fuel) q = q.eq('fuel', sp.fuel);
  if (sp.seats) q = q.gte('seats', Number(sp.seats));
  if (sp.max_price) q = q.lte('price_per_day', Number(sp.max_price));
  // Condition Match Search: only keep cars that satisfy every ticked condition
  if (sp.unlimited_km) q = q.is('km_limit_per_day', null);
  if (sp.no_deposit) q = q.eq('security_deposit', 0);
  if (sp.airport) q = q.eq('airport_pickup', true);
  if (sp.pets) q = q.eq('pet_friendly', true);
  if (sp.delivery) q = q.eq('delivery_available', true);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(48);
  const cars = (data ?? []) as Car[];

  return (
    <main className="wrap">
      <h1>Find a car</h1>
      <form className="filters">
        <label>City<input name="city" defaultValue={sp.city} /></label>
        <label>Type<select name="car_type" defaultValue={sp.car_type ?? ''}><option value="">Any</option>{['hatchback','sedan','suv','muv','luxury'].map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Fuel<select name="fuel" defaultValue={sp.fuel ?? ''}><option value="">Any</option>{['petrol','diesel','cng','electric'].map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Min seats<input name="seats" type="number" min={2} max={12} defaultValue={sp.seats} /></label>
        <label>Max ₹/day<input name="max_price" type="number" min={0} defaultValue={sp.max_price} /></label>
        <label className="check"><input type="checkbox" name="unlimited_km" value="1" defaultChecked={!!sp.unlimited_km} />Unlimited km</label>
        <label className="check"><input type="checkbox" name="no_deposit" value="1" defaultChecked={!!sp.no_deposit} />No deposit</label>
        <label className="check"><input type="checkbox" name="airport" value="1" defaultChecked={!!sp.airport} />Airport pickup</label>
        <label className="check"><input type="checkbox" name="pets" value="1" defaultChecked={!!sp.pets} />Pet friendly</label>
        <label className="check"><input type="checkbox" name="delivery" value="1" defaultChecked={!!sp.delivery} />Delivery</label>
        <button className="btn">Apply filters</button>
      </form>

      {error ? <div className="err" role="alert">Couldn’t load cars: {error.message}. Check your Supabase keys in .env.local.</div>
      : cars.length === 0 ? <div className="empty"><h2>No cars match these filters</h2><p>Remove a filter or try a nearby city.</p></div>
      : <div className="grid">{cars.map(c => (
          <Link key={c.id} href={`/cars/${c.id}`} className="car">
            {c.car_photos?.[0] ? <img src={c.car_photos[0].url} alt={c.title} loading="lazy" /> : <div className="ph" />}
            <div>
              <h3>{c.title}</h3>
              <p style={{ margin: 0 }}>{c.city} · {c.seats} seats · {c.fuel} · {c.transmission}</p>
              <p className="price">{rupees(c.price_per_day)} / day</p>
              <div className="tags">
                {c.km_limit_per_day === null && <span className="tag">Unlimited km</span>}
                {c.security_deposit === 0 && <span className="tag">No deposit</span>}
                {c.airport_pickup && <span className="tag">Airport pickup</span>}
              </div>
            </div>
          </Link>))}</div>}
    </main>
  );
}
