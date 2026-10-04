export function money(n: number, currency = 'SGD'): string {
  const sign = n < 0 ? '(' : '';
  const close = n < 0 ? ')' : '';
  const v = Math.abs(Math.round(n));
  if (v === 0) return '–';
  return `${sign}${currency === 'SGD' ? 'S$' : currency + ' '}${v.toLocaleString()}${close}`;
}

export function num(n: number): string {
  if (!n) return '–';
  return n.toLocaleString();
}

export function pct(n: number, dp = 1): string {
  return `${(n * 100).toFixed(dp)}%`;
}

export function dateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ts(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
