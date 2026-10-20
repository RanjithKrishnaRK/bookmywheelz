import './globals.css';
import Link from 'next/link';

export const metadata = { title: 'BookMyWheelz', description: 'Own a car? Earn from it. Need a car? Book it in minutes.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="bar">
          <Link href="/" className="logo">BookMyWheelz</Link>
          <nav><Link href="/search">Find a car</Link><Link href="/owner/new">List your car</Link><Link href="/login">Sign in</Link></nav>
        </header>
        {children}
      </body>
    </html>
  );
}
