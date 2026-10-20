import Link from 'next/link';

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>Own a car? Earn from it.</h1>
          <p>Need a car for a day, a weekend or longer? Pick one from owners near you and filter by what matters: no deposit, unlimited km, airport pickup.</p>
          <form action="/search" style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <input name="city" placeholder="City, e.g. Hyderabad" aria-label="City" style={{ maxWidth: 280 }} />
            <button className="btn">Search cars</button>
          </form>
          <p style={{ marginTop: '1.5rem' }}>Have a car sitting idle? <Link href="/owner/new"><b>List it in 5 minutes</b></Link></p>
        </div>
      </section>
    </>
  );
}
