"use server"

import { sql } from "@/lib/db"
import { revalidatePath } from "next/cache"
import crypto from "crypto"
import { getCurrentUserId } from "@/lib/auth"

export interface Setting {
  id: number
  key: string
  value: string | null
  description: string | null
}

const SENSITIVE_KEYS = new Set(["ai_api_key", "smtp_pass"])
function getKey(): Buffer {
  const secret = process.env.CONFIG_ENCRYPTION_SECRET || ""
  return crypto.createHash("sha256").update(secret).digest()
}
function encryptIfNeeded(key: string, value: string): string {
  if (!SENSITIVE_KEYS.has(key)) return value
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv)
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:gcm:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`
}
function decryptIfNeeded(key: string, value: string | null): string | null {
  if (!value) return null
  if (!SENSITIVE_KEYS.has(key)) return value
  if (!value.startsWith("enc:gcm:")) return value
  const [, , ivB64, tagB64, dataB64] = value.split(":")
  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const data = Buffer.from(dataB64, "base64")
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(data), decipher.final()])
  return dec.toString("utf8")
}

export async function getSettings(): Promise<Setting[]> {
  try {
    const userId = await getCurrentUserId()
    const defaults = await Promise.resolve(sql<{ id: number; key: string; value: string | null; description: string | null }[]>`
      SELECT id, key, value, description FROM settings WHERE user_id IS NULL ORDER BY key ASC
    `)
    const overrides = userId
      ? await Promise.resolve(sql<{ id: number; key: string; value: string | null; description: string | null }[]>`
          SELECT id, key, value, description FROM settings WHERE user_id = ${userId}
        `)
      : []
    const byKey = new Map<string, Setting>()
    for (const s of defaults) {
      const v = decryptIfNeeded(s.key, s.value ?? null)
      byKey.set(s.key, {
        id: s.id,
        key: s.key,
        value: s.key === "ai_api_key" && v ? "__MASKED__" : v,
        description: s.description ?? null,
      })
    }
    for (const o of overrides || []) {
      const v = decryptIfNeeded(o.key, o.value ?? null)
      const ex = byKey.get(o.key)
      if (ex) {
        byKey.set(o.key, {
          id: ex.id,
          key: ex.key,
          value: o.key === "ai_api_key" && v ? "__MASKED__" : v,
          description: ex.description,
        })
      } else {
        byKey.set(o.key, {
          id: o.id,
          key: o.key,
          value: o.key === "ai_api_key" && v ? "__MASKED__" : v,
          description: o.description ?? null,
        })
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key))
  } catch {
    return []
  }
}

export async function getSetting(key: string): Promise<string | null> {
  try {
    const userId = await getCurrentUserId()
    if (userId) {
      const u = await Promise.resolve(sql<{ value: string | null }[]>`
        SELECT value FROM settings WHERE user_id = ${userId} AND key = ${key} LIMIT 1
      `)
      if (u[0]) {
        return decryptIfNeeded(key, u[0].value ?? null)
      }
    }
    const d = await Promise.resolve(sql<{ value: string | null }[]>`
      SELECT value FROM settings WHERE user_id IS NULL AND key = ${key} LIMIT 1
    `)
    const raw = d[0]?.value ?? null
    return decryptIfNeeded(key, raw)
  } catch {
    return null
  }
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const toStore = encryptIfNeeded(key, value)
  const userId = await getCurrentUserId()
  if (!userId) return
  await sql`
    INSERT INTO settings (user_id, key, value, created_at, updated_at)
    VALUES (${userId}, ${key}, ${toStore}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, key) DO UPDATE SET value = ${toStore}, updated_at = CURRENT_TIMESTAMP
  `
  revalidatePath("/configuracion")
}

export async function updateSettings(settings: { key: string; value: string }[]): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) return
  for (const setting of settings) {
    if (setting.key === "ai_api_key" && setting.value === "__MASKED__") continue
    const toStore = encryptIfNeeded(setting.key, setting.value)
    await sql`
      INSERT INTO settings (user_id, key, value, created_at, updated_at)
      VALUES (${userId}, ${setting.key}, ${toStore}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, key) DO UPDATE SET value = ${toStore}, updated_at = CURRENT_TIMESTAMP
    `
  }
  revalidatePath("/configuracion")
}
