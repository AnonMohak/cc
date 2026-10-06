/**
 * Short star count for narrow labels: 950, 80k, 120.5k, 1m.
 * One decimal at most, and only when it is not zero.
 * @param {number} n
 */
export function formatCount(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${trim(n / 1e3)}k`;
  return `${trim(n / 1e6)}m`;
}

function trim(value) {
  return String(Math.round(value * 10) / 10);
}
