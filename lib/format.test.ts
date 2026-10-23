import { describe, expect, it } from 'vitest';
import { formatDay, formatPaise, formatWhen, toLocalInput } from './format';

describe('formatPaise', () => {
  it.each([[0, '₹0'], [100, '₹1'], [300_000, '₹3,000'], [10_000_000, '₹1,00,000'], [1_500_000_000, '₹1,50,00,000']])('%i paise => %s (whole rupees, Indian grouping)', (p, s) => expect(formatPaise(p)).toBe(s));
  it.each([[15015, '₹150.15'], [1, '₹0.01'], [110, '₹1.10'], [17, '₹0.17']])('%i paise => %s (never hides a paisa)', (p, s) => expect(formatPaise(p)).toBe(s));
});

describe('toLocalInput', () => {
  it('round-trips to the same minute in local time, in any timezone', () => {
    const d = new Date(2030, 0, 5, 9, 7, 33, 500); // local components
    const back = new Date(toLocalInput(d));
    expect(back.getTime()).toBe(new Date(2030, 0, 5, 9, 7).getTime());
  });
  it('zero-pads every field', () => expect(toLocalInput(new Date(2030, 0, 2, 3, 4))).toBe('2030-01-02T03:04'));
});

describe('date formatting', () => {
  it('names the month and includes the day', () => {
    expect(formatWhen(new Date(2030, 10, 5, 14, 30))).toMatch(/5.*Nov/);
    expect(formatDay(new Date(2030, 10, 5))).toMatch(/Nov.*2030/);
  });
});
