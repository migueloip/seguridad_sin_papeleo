/**
 * Validación del parámetro de retorno tras iniciar sesión (?next=...). Puro:
 * se usa en servidor (loginAction / registerAction) y en las páginas de auth.
 *
 * Solo se aceptan rutas relativas del mismo sitio ("/obra/12",
 * "/invitacion/<token>"). Se rechaza todo lo que un navegador podría
 * interpretar como otro origen: "//host", "/\host", URLs absolutas,
 * caracteres de control o espacios (los navegadores quitan tabulaciones y
 * saltos de línea: "/\t/host" termina en "//host") y rutas que al
 * normalizarse empiezan con "//" ("/.//host").
 */

export const SAFE_NEXT_MAX_LENGTH = 2048

const BASE = "http://ssp.invalid"

/** Controles C0/C1, espacios y separadores o invisibles Unicode. */
function isUnsafeChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (
    c <= 0x20 ||
    (c >= 0x7f && c <= 0xa0) ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200f) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  )
}

/** Ruta relativa segura para redirigir, o null si no se debe usar. */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const v = raw
  if (!v || v.length > SAFE_NEXT_MAX_LENGTH) return null
  if (!v.startsWith("/") || v.startsWith("//")) return null
  if (v.includes("\\")) return null
  for (const ch of v) if (isUnsafeChar(ch)) return null
  let u: URL
  try {
    u = new URL(v, BASE)
  } catch {
    return null
  }
  if (u.origin !== BASE) return null
  const out = `${u.pathname}${u.search}${u.hash}`
  if (!out.startsWith("/") || out.startsWith("//") || out.includes("\\")) return null
  return out
}
