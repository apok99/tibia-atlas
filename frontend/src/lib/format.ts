/** Format a number compactly: 1.46M, 12.3K, 980. */
export function compact(n: number): string {
  if (!isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e12) return (n / 1e12).toFixed(2).replace(/\.00$/, '') + 'T'
  if (abs >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M'
  if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return Math.round(n).toLocaleString()
}
