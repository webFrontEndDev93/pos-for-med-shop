/** Formatting and date helpers shared across every screen. */

const DEFAULT_SYMBOL = 'Rs';

let symbol = DEFAULT_SYMBOL;
/** Word-like symbols ("Rs", "PKR") need a gap; glyphs ("₨", "$") do not. */
let gap = ' ';

export const setCurrencySymbol = (next: string) => {
  symbol = next || DEFAULT_SYMBOL;
  gap = /[A-Za-z]$/.test(symbol) ? ' ' : '';
};

// en-PK groups in thousands (1,842,424.50) rather than the Indian lakh style.
const grouped = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const groupedWhole = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

const withSymbol = (text: string) => `${symbol}${gap}${text}`;

export const money = (value: number) => withSymbol(grouped.format(Number(value) || 0));
export const moneyShort = (value: number) => withSymbol(groupedWhole.format(Math.round(Number(value) || 0)));
export const plain = (value: number) => grouped.format(Number(value) || 0);
export const count = (value: number) => groupedWhole.format(Number(value) || 0);

/**
 * Rs 1.8M / Rs 45.3k — keeps stat tiles and axis labels from wrapping.
 * Scales in thousands and millions to match the en-PK digit grouping; mixing
 * international grouping with lakh/crore suffixes reads badly on an axis.
 */
export function compactMoney(value: number) {
  const n = Math.abs(Number(value) || 0);
  const sign = value < 0 ? '-' : '';
  if (n >= 1e9) return `${sign}${withSymbol(`${(n / 1e9).toFixed(2)}B`)}`;
  if (n >= 1e6) return `${sign}${withSymbol(`${(n / 1e6).toFixed(2)}M`)}`;
  if (n >= 1e3) return `${sign}${withSymbol(`${(n / 1e3).toFixed(1)}k`)}`;
  return `${sign}${withSymbol(n.toFixed(0))}`;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const startOfMonth = () => `${todayISO().slice(0, 7)}-01`;

/** 16 Sep 2026 */
export function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Sep 2026 — how expiry is printed on a medicine pack. */
export function formatMonthYear(iso: string) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-PK', { month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PK', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}

export function daysUntil(iso: string) {
  const target = new Date(`${iso}T00:00:00`).getTime();
  const now = new Date(`${todayISO()}T00:00:00`).getTime();
  return Math.round((target - now) / 86_400_000);
}

/** "in 3 months", "12 days left", "expired 5 days ago" */
export function expiryLabel(iso: string) {
  const days = daysUntil(iso);
  if (days < 0) return `expired ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'expires today';
  if (days < 45) return `${days} ${days === 1 ? 'day' : 'days'} left`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} left`;
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/**
 * Case-insensitive subsequence match used by the product search: typing "pcm650"
 * still finds "Paracetamol 650mg". Returns a score (lower is better) or -1.
 */
export function fuzzyScore(haystack: string, needle: string) {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();

  const exact = h.indexOf(n);
  if (exact === 0) return 0;
  if (exact > 0) return 1 + exact * 0.01;

  let score = 40;
  let position = 0;
  for (const char of n) {
    const found = h.indexOf(char, position);
    if (found === -1) return -1;
    score += found - position;
    position = found + 1;
  }
  return score;
}
