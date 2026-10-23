// Display helpers. Money is stored as integer PAISE everywhere; convert only at the last moment, here.

// Whole rupees print without decimals (₹3,000); anything else keeps two (₹150.15) so a split-fee rounding
// paisa is never hidden from the person paying it. en-IN grouping gives lakh style: ₹1,00,000.
export function formatPaise(paise: number): string {
  const whole = paise % 100 === 0;
  return '₹' + (paise / 100).toLocaleString('en-IN', whole ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatWhen(value: string | Date): string {
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function formatDay(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// "YYYY-MM-DDTHH:mm" in the viewer's LOCAL time: the value format <input type="datetime-local"> uses.
// new Date(thisString) reads it back as local time, so a renter in India picking 10:00 means 10:00 IST,
// and toISOString() then turns it into the unambiguous UTC instant the API expects.
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
