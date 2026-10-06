import { NextResponse } from "next/server"
import crypto from "crypto"
import { sql } from "@/lib/db"
import { resolveAiSettings, type AiSettings } from "@/lib/ai-settings"

/**
 * Utilidades compartidas por las rutas /api/mobile/* (autenticación Bearer):
 * CORS para la app de terreno (otro origen) y lectura de settings por userId
 * (getSetting de actions/settings usa la cookie de sesión, que aquí no existe).
 */

export const MOBILE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
}

export function mobileJson(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: MOBILE_CORS_HEADERS })
}

export function mobileOptions() {
  return new NextResponse(null, { status: 204, headers: MOBILE_CORS_HEADERS })
}

const SENSITIVE_KEYS = new Set(["ai_api_key", "smtp_pass"])

function decryptIfNeeded(key: string, value: string | null): string | null {
  if (!value) return null
  if (!SENSITIVE_KEYS.has(key)) return value
  if (!value.startsWith("enc:gcm:")) return value
  try {
    const [, , ivB64, tagB64, dataB64] = value.split(":")
    const iv = Buffer.from(ivB64, "base64")
    const tag = Buffer.from(tagB64, "base64")
    const data = Buffer.from(dataB64, "base64")
    const secret = process.env.CONFIG_ENCRYPTION_SECRET || ""
    const k = crypto.createHash("sha256").update(secret).digest()
    const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(data), decipher.final()])
    return dec.toString("utf8")
  } catch {
    return null
  }
}

/** Valor guardado por el propio usuario o el global, por separado (sin mezclar dueños). */
async function readOwnAndGlobal(userId: number, key: string): Promise<{ own: string | null; global: string | null }> {
  try {
    const [u, d] = await Promise.all([
      sql<{ value: string | null }[]>`SELECT value FROM settings WHERE user_id = ${userId} AND key = ${key} LIMIT 1`,
      sql<{ value: string | null }[]>`SELECT value FROM settings WHERE user_id IS NULL AND key = ${key} LIMIT 1`,
    ])
    return { own: decryptIfNeeded(key, u[0]?.value ?? null), global: decryptIfNeeded(key, d[0]?.value ?? null) }
  } catch {
    return { own: null, global: null }
  }
}

/**
 * Configuración de IA por userId (equivalente Bearer de getAiSettings). El
 * módulo Obra la usa con el dueño del proyecto. Una URL base propia solo se
 * combina con la key propia (ver lib/ai-settings.ts).
 */
export async function getAiSettingsForUser(userId: number): Promise<AiSettings> {
  const [provider, model, apiKey, baseUrl] = await Promise.all(
    (["ai_provider", "ai_model", "ai_api_key", "ai_base_url"] as const).map((k) => readOwnAndGlobal(userId, k)),
  )
  return resolveAiSettings(
    { provider: provider.own, model: model.own, apiKey: apiKey.own, baseUrl: baseUrl.own },
    { provider: provider.global, model: model.global, apiKey: apiKey.global, baseUrl: baseUrl.global },
  )
}

/** getSetting con userId explícito (override de usuario → default global). */
export async function getSettingForUser(userId: number, key: string): Promise<string | null> {
  try {
    const u = await sql<{ value: string | null }>`
      SELECT value FROM settings WHERE user_id = ${userId} AND key = ${key} LIMIT 1
    `
    if (u[0]) return decryptIfNeeded(key, u[0].value ?? null)
    const d = await sql<{ value: string | null }>`
      SELECT value FROM settings WHERE user_id IS NULL AND key = ${key} LIMIT 1
    `
    return decryptIfNeeded(key, d[0]?.value ?? null)
  } catch {
    return null
  }
}
