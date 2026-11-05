export const money = (v: number, currency = 'S$') =>
  `${v < 0 ? '-' : ''}${currency}${Math.round(Math.abs(v)).toLocaleString()}`;

export const pct = (v: number, dp = 1) => `${v.toFixed(dp)}%`;

export const dateShort = (iso: string) =>
  new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

export const ts = (iso: string) =>
  new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
