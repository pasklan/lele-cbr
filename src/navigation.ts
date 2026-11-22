export function clampPage(page: number, count: number): number {
  return Math.max(0, Math.min(Math.trunc(page), count - 1));
}
