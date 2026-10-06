/**
 * Resolución de la configuración de IA (pura, sin BD ni sesión). La usan
 * getAiSettings (lib/settings.ts, sesión web) y getAiSettingsForUser
 * (lib/mobile-api.ts, Bearer y módulo Obra).
 *
 * Regla de seguridad: la API key y la URL base deben venir del MISMO dueño.
 * - Si el usuario define su propia URL base (ai_base_url), solo se usa con SU
 *   propia API key; nunca con la key global de la tabla settings ni con la del
 *   entorno (AI_API_KEY / GOOGLE_API_KEY). Si no, cualquier usuario registrado
 *   podría apuntar la URL a un servidor suyo y recibir la key del servidor en
 *   la cabecera de la petición.
 * - La URL base propia debe ser http(s) y, en producción, https hacia un host
 *   público (sin localhost, IPs privadas, link-local ni metadatos de la nube),
 *   para no convertir el servidor en un proxy hacia la red interna (SSRF).
 *   AI_ALLOW_PRIVATE_BASE_URL=1 lo permite en instalaciones propias.
 * - La key global solo se usa con el proveedor global (no se manda una key de
 *   un proveedor a otro).
 */
import { defaultModelFor } from "@/lib/ai"

export type AiSettings = {
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
  /** true si hay lo mínimo para llamar al proveedor (custom permite key vacía). */
  ready: boolean
}

/** Valores de IA guardados por UN dueño (el usuario o la configuración global), sin mezclar. */
export type AiSettingValues = {
  provider?: string | null
  model?: string | null
  apiKey?: string | null
  baseUrl?: string | null
}

type Env = Record<string, string | undefined>

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null
}

function isPrivateIpv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local y metadatos de la nube
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** ¿El host (sin corchetes) apunta a la máquina local o a una red privada? */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (!h) return true
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true
  if (h === "metadata" || h === "metadata.google.internal") return true
  const v4 = ipv4Parts(h)
  if (v4) return isPrivateIpv4(v4)
  if (h.includes(":")) {
    // IPv6 literal: loopback, no especificada, ULA (fc00::/7), link-local (fe80::/10) y IPv4 mapeadas.
    if (h === "::1" || h === "::") return true
    if (/^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h)) return true
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h)
    if (mapped) {
      const p = ipv4Parts(mapped[1])
      return p ? isPrivateIpv4(p) : true
    }
    if (h.startsWith("::ffff:")) return true
  }
  // Hosts de una sola etiqueta ("intranet", "db") solo resuelven en redes internas.
  if (!h.includes(".") && !h.includes(":")) return true
  return false
}

/**
 * ¿Se puede usar esta URL base definida por un usuario? En desarrollo se
 * admite http y localhost (Ollama, LM Studio); en producción solo https hacia
 * hosts públicos, salvo AI_ALLOW_PRIVATE_BASE_URL=1.
 */
export function isAllowedUserAiBaseUrl(raw: string, env: Env = process.env): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false
  if (u.username || u.password) return false
  if (env.AI_ALLOW_PRIVATE_BASE_URL === "1") return true
  if (env.NODE_ENV !== "production") return true
  if (u.protocol !== "https:") return false
  return !isPrivateHost(u.hostname)
}

/**
 * Combina la configuración propia del usuario (`own`, solo sus filas) con la
 * global (`global`, filas sin user_id) sin mezclar la key de un dueño con la
 * URL base del otro.
 */
export function resolveAiSettings(own: AiSettingValues, global: AiSettingValues, env: Env = process.env): AiSettings {
  const globalProvider = clean(global.provider) || "google"
  const provider = clean(own.provider) || globalProvider
  const sameProvider = provider === globalProvider
  const model = clean(own.model) || (sameProvider ? clean(global.model) : "") || defaultModelFor(provider)
  const ownBase = clean(own.baseUrl)
  const ownKey = clean(own.apiKey)

  if (ownBase) {
    // URL propia: solo con la key propia. Nunca la global ni la del entorno.
    const allowed = isAllowedUserAiBaseUrl(ownBase, env)
    const baseUrl = allowed ? ownBase : null
    const ready = allowed && (provider === "custom" ? true : Boolean(ownKey))
    return { provider, model, apiKey: ownKey, baseUrl, ready }
  }

  const baseUrl = sameProvider ? clean(global.baseUrl) || null : null
  const globalKey = sameProvider ? clean(global.apiKey) : ""
  const envKey = provider === "google" ? clean(env.AI_API_KEY) || clean(env.GOOGLE_API_KEY) : ""
  const apiKey = ownKey || globalKey || envKey
  const ready = provider === "custom" ? Boolean(baseUrl) : Boolean(apiKey)
  return { provider, model, apiKey, baseUrl, ready }
}
