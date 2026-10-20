'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const TYPES = ['hatchback','sedan','suv','muv','luxury'];

export default function NewCar() {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null)); }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const files = (f.getAll('photos') as File[]).filter(x => x.size > 0);
    if (files.length < 1 || files.length > 8) return setMsg({ ok: false, text: 'Add 1 to 8 photos.' });
    if (files.some(x => !x.type.startsWith('image/') || x.size > 5_000_000)) return setMsg({ ok: false, text: 'Photos must be images under 5 MB each.' });
    setBusy(true); setMsg(null);
    const n = (k: string) => Number(f.get(k));
    const km = String(f.get('km_limit_per_day') ?? '').trim();
    const { data: car, error } = await supabase.from('cars').insert({
      owner_id: uid, title: f.get('title'), make: f.get('make'), model: f.get('model'), year: n('year'),
      car_type: f.get('car_type'), fuel: f.get('fuel'), seats: n('seats'), transmission: f.get('transmission'),
      city: String(f.get('city')).trim(), area: f.get('area') || null, description: f.get('description') || null,
      price_per_day: n('price_per_day'), km_limit_per_day: km === '' ? null : Number(km),
      security_deposit: n('security_deposit') || 0, min_rental_days: n('min_rental_days') || 1,
      min_driver_age: n('min_driver_age') || 21,
      airport_pickup: f.has('airport_pickup'), pet_friendly: f.has('pet_friendly'), delivery_available: f.has('delivery_available'),
    }).select('id').single();
    if (error || !car) { setBusy(false); return setMsg({ ok: false, text: error?.message ?? 'Could not save the car.' }); }
    for (const [i, file] of files.entries()) {
      const path = `${uid}/${car.id}/${i}-${file.name.replace(/[^\w.]/g, '_')}`;
      const up = await supabase.storage.from('car-photos').upload(path, file);
      if (up.error) { setBusy(false); return setMsg({ ok: false, text: `Photo ${i + 1} failed: ${up.error.message}` }); }
      const url = supabase.storage.from('car-photos').getPublicUrl(path).data.publicUrl;
      await supabase.from('car_photos').insert({ car_id: car.id, url, sort: i });
    }
    setBusy(false); setMsg({ ok: true, text: 'Submitted. Your car goes live after admin approval.' });
    (e.target as HTMLFormElement).reset();
  }

  if (uid === undefined) return <main className="wrap"><p>Loading…</p></main>;
  if (uid === null) return <main className="wrap"><div className="empty"><h2>Sign in to list your car</h2><a className="btn" href="/login">Sign in</a></div></main>;

  return (
    <main className="wrap">
      <h1>List your car</h1>
      <form className="form" onSubmit={submit}>
        <label>Listing title<input name="title" required maxLength={80} placeholder="Swift VXi, clean and fuel-efficient" /></label>
        <div className="two"><label>Make<input name="make" required /></label><label>Model<input name="model" required /></label></div>
        <div className="two">
          <label>Year<input name="year" type="number" min={2005} max={2030} required /></label>
          <label>Type<select name="car_type">{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Fuel<select name="fuel">{['petrol','diesel','cng','electric'].map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Transmission<select name="transmission"><option>manual</option><option>automatic</option></select></label>
          <label>Seats<input name="seats" type="number" min={2} max={12} defaultValue={5} required /></label>
          <label>Price per day (₹)<input name="price_per_day" type="number" min={1} required /></label>
        </div>
        <div className="two"><label>City<input name="city" required /></label><label>Area<input name="area" /></label></div>
        <label>Description<textarea name="description" rows={3} maxLength={1000} /></label>
        <h3>Your conditions</h3>
        <div className="two">
          <label>Km limit per day (blank = unlimited)<input name="km_limit_per_day" type="number" min={50} /></label>
          <label>Security deposit (₹, 0 = none)<input name="security_deposit" type="number" min={0} defaultValue={0} /></label>
          <label>Minimum rental (days)<input name="min_rental_days" type="number" min={1} defaultValue={1} /></label>
          <label>Minimum driver age<input name="min_driver_age" type="number" min={18} defaultValue={21} /></label>
        </div>
        <label className="check"><input type="checkbox" name="airport_pickup" />Airport pickup</label>
        <label className="check"><input type="checkbox" name="pet_friendly" />Pet friendly</label>
        <label className="check"><input type="checkbox" name="delivery_available" />Doorstep delivery</label>
        <label>Photos (1 to 8, under 5 MB each)<input name="photos" type="file" accept="image/*" multiple required /></label>
        <button className="btn" disabled={busy}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? '' : 'err'}>{msg.text}</p>}
      </form>
    </main>
  );
}
