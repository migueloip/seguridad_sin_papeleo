import { NextResponse } from "next/server"
import crypto from "crypto"
import { sql } from "@/lib/db"

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

/** Configuración de IA por userId (equivalente Bearer de getAiSettings). */
export async function getAiSettingsForUser(userId: number): Promise<{
  provider: string
  model: string
  apiKey: string
  baseUrl: string | null
  ready: boolean
}> {
  const { defaultModelFor } = await import("@/lib/ai")
  const [provider0, model0, key0, baseUrl0] = await Promise.all([
    getSettingForUser(userId, "ai_provider"),
    getSettingForUser(userId, "ai_model"),
    getSettingForUser(userId, "ai_api_key"),
    getSettingForUser(userId, "ai_base_url"),
  ])
  const provider = provider0 || "google"
  const apiKey =
    key0 || (provider === "google" ? process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || "" : "")
  const baseUrl = baseUrl0?.trim() || null
  const model = model0?.trim() || defaultModelFor(provider)
  const ready = provider === "custom" ? Boolean(baseUrl) : Boolean(apiKey)
  return { provider, model, apiKey, baseUrl, ready }
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
