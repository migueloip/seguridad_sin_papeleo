export function parseIntId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const id = Number.parseInt(raw, 10)
  if (!Number.isFinite(id) || id <= 0) return null
  return id
}
