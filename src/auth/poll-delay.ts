/** RFC 8628 §3.5 / Kourier auth.md: `slow_down` means wait longer between polls,
 * and the longer interval applies to every subsequent poll, not just the next one. */
export const SLOW_DOWN_INCREMENT_MS = 5000;

// gdp: law no slow_down leaves the interval unchanged: not slowDown implies result == currentMs
// gdp: law a slow_down adds exactly 5000: slowDown implies result == currentMs + 5000
export function nextPollDelay(currentMs: number, slowDown: boolean): number {
  return slowDown ? currentMs + SLOW_DOWN_INCREMENT_MS : currentMs;
}
