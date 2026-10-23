import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { supabase, rupees, type Car } from '@/lib/supabase';
import BookingWidget from '@/components/BookingWidget';

async function CarDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabase.from('cars').select('*, car_photos(url, sort)').eq('id', id).maybeSingle();
  if (!data) notFound();
  const c = data as Car;
  const photos = [...(c.car_photos ?? [])].sort((a, b) => a.sort - b.sort);
  return (
    <main className="wrap layout">
      <div>
      <h1>{c.title}</h1>
      <p>{c.year} {c.make} {c.model} · {c.city}{c.area ? `, ${c.area}` : ''}</p>
      <div className="gallery">{photos.map(p => <img key={p.url} src={p.url} alt={c.title} loading="lazy" />)}</div>
      <h2>{rupees(c.price_per_day)} / day</h2>
      <p>{c.description}</p>
      <h3>Owner’s conditions</h3>
      <ul>
        <li>Distance: {c.km_limit_per_day === null ? 'Unlimited km' : `${c.km_limit_per_day} km per day`}</li>
        <li>Security deposit: {c.security_deposit === 0 ? 'None' : rupees(c.security_deposit)}</li>
        <li>Minimum rental: {c.min_rental_days} day(s)</li>
        <li>Driver age: {c.min_driver_age}+</li>
        <li>Fuel policy: {c.fuel_policy}</li>
        <li>Airport pickup: {c.airport_pickup ? 'Yes' : 'No'} · Pets: {c.pet_friendly ? 'Yes' : 'No'} · Delivery: {c.delivery_available ? 'Yes' : 'No'}</li>
      </ul>
      </div>
      <BookingWidget car={{ id: c.id, owner_id: c.owner_id, price_per_day: c.price_per_day, security_deposit: c.security_deposit, min_rental_days: c.min_rental_days, km_limit_per_day: c.km_limit_per_day, instant_book: c.instant_book }} />
    </main>
  );
}

export default function CarPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="wrap"><p>Loading car…</p></main>}>
      <CarDetails params={params} />
    </Suspense>
  );
}