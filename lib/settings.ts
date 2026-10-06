/**
 * Configuración de la cuenta (tabla settings) para uso SOLO en servidor.
 *
 * Vive fuera de app/actions/settings.ts a propósito: cada export de un archivo
 * "use server" es un endpoint público que cualquiera puede invocar, así que la
 * lectura de valores secretos (API key de IA, clave SMTP) y getAiSettings, que
 * devuelve la key descifrada, no pueden estar ahí. Las acciones públicas
 * importan estas utilidades y nunca devuelven claves sensibles.
 */
import crypto from "crypto"
import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { resolveAiSettings, type AiSettings } from "@/lib/ai-settings"

/** Claves que se guardan cifradas y nunca se devuelven al navegador. */
export const SENSITIVE_SETTING_KEYS: ReadonlySet<string> = new Set(["ai_api_key", "smtp_pass"])

function encryptionKey(): Buffer {
  const secret = process.env.CONFIG_ENCRYPTION_SECRET || ""
  return crypto.createHash("sha256").update(secret).digest()
}

export function encryptSettingIfNeeded(key: string, value: string): string {
  if (!SENSITIVE_SETTING_KEYS.has(key)) return value
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:gcm:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`
}

export function decryptSettingIfNeeded(key: string, value: string | null): string | null {
  if (!value) return null
  if (!SENSITIVE_SETTING_KEYS.has(key)) return value
  if (!value.startsWith("enc:gcm:")) return value
  const [, , ivB64, tagB64, dataB64] = value.split(":")
  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const data = Buffer.from(dataB64, "base64")
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(data), decipher.final()])
  return dec.toString("utf8")
}

/**
 * Valor de una clave para el usuario de la sesión (su valor propio o, si no
 * tiene, el valor global). Incluye claves sensibles descifradas: usar solo en
 * servidor y nunca devolverlo tal cual al cliente.
 */
export async function readSetting(key: string): Promise<string | null> {
  try {
    const userId = await getCurrentUserId()
    if (userId) {
      const u = await sql<{ value: string | null }[]>`
        SELECT value FROM settings WHERE user_id = ${userId} AND key = ${key} LIMIT 1
      `
      if (u[0]) return decryptSettingIfNeeded(key, u[0].value ?? null)
    }
    const d = await sql<{ value: string | null }[]>`
      SELECT value FROM settings WHERE user_id IS NULL AND key = ${key} LIMIT 1
    `
    return decryptSettingIfNeeded(key, d[0]?.value ?? null)
  } catch {
    return null
  }
}

export type { AiSettings } from "@/lib/ai-settings"

/** Valor guardado por el propio usuario (sin caer al global), descifrado si es sensible. */
async function readOwnSetting(userId: number, key: string): Promise<string | null> {
  try {
    const u = await sql<{ value: string | null }[]>`
      SELECT value FROM settings WHERE user_id = ${userId} AND key = ${key} LIMIT 1
    `
    return decryptSettingIfNeeded(key, u[0]?.value ?? null)
  } catch {
    return null
  }
}

/** Valor global (user_id IS NULL), descifrado si es sensible. */
async function readGlobalSetting(key: string): Promise<string | null> {
  try {
    const d = await sql<{ value: string | null }[]>`
      SELECT value FROM settings WHERE user_id IS NULL AND key = ${key} LIMIT 1
    `
    return decryptSettingIfNeeded(key, d[0]?.value ?? null)
  } catch {
    return null
  }
}

const AI_KEYS = ["ai_provider", "ai_model", "ai_api_key", "ai_base_url"] as const

/**
 * Configuración de IA unificada (proveedor, modelo, key, URL base) del usuario
 * de la sesión, con defaults por proveedor. Único punto de verdad para los
 * flujos de IA con sesión web (la API móvil usa getAiSettingsForUser).
 *
 * Lee por separado lo del usuario y lo global y los combina con
 * resolveAiSettings: una URL base propia nunca se usa con la key global ni
 * con la del entorno (evita que un usuario reciba la key del servidor en un
 * host suyo).
 */
export async function getAiSettings(): Promise<AiSettings> {
  let userId: number | null = null
  try {
    userId = (await getCurrentUserId()) ?? null
  } catch {
    userId = null
  }
  const [own, global] = await Promise.all([
    userId ? Promise.all(AI_KEYS.map((k) => readOwnSetting(userId as number, k))) : Promise.resolve(AI_KEYS.map(() => null)),
    Promise.all(AI_KEYS.map((k) => readGlobalSetting(k))),
  ])
  return resolveAiSettings(
    { provider: own[0], model: own[1], apiKey: own[2], baseUrl: own[3] },
    { provider: global[0], model: global[1], apiKey: global[2], baseUrl: global[3] },
  )
}
