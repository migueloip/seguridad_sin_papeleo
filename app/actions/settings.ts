"use server"

import { prisma, sql } from "@/lib/db"
import { revalidatePath } from "next/cache"
import crypto from "crypto"
import { getCurrentUserId } from "@/lib/auth"

export interface Setting {
  id: number
  key: string
  value: string | null
  description: string | null
}

const SENSITIVE_KEYS = new Set(["ai_api_key"]) 
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
    const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } })
    const userId = await getCurrentUserId()
    let overrides: Record<string, string | null> = {}
    if (userId) {
      const urows = await sql<{ key: string; value: string | null }>`
        SELECT key, value FROM user_settings WHERE user_id = ${userId}
      `
      overrides = Object.fromEntries(
        (urows || []).map((r) => [r.key, decryptIfNeeded(r.key, r.value)]),
      )
    }
    return rows.map((s: { id: number; key: string; value: string | null; description: string | null }): Setting => {
      const ov = overrides[s.key]
      const v = ov !== undefined ? ov : s.value ?? null
      return {
        id: s.id,
        key: s.key,
        value: s.key === "ai_api_key" && v ? "__MASKED__" : v,
        description: s.description ?? null,
      }
    })
  } catch {
    return []
  }
}

export async function getSetting(key: string): Promise<string | null> {
  try {
    const userId = await getCurrentUserId()
    if (userId) {
      const u = await sql<{ value: string | null }>`
        SELECT value FROM user_settings WHERE user_id = ${userId} AND key = ${key} LIMIT 1
      `
      if (u[0]) {
        return decryptIfNeeded(key, u[0].value ?? null)
      }
    }
    const row = await prisma.setting.findUnique({ where: { key } })
    const raw = row?.value ?? null
    return decryptIfNeeded(key, raw)
  } catch {
    return null
  }
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const toStore = encryptIfNeeded(key, value)
  const userId = await getCurrentUserId()
  if (userId) {
    await sql`
      INSERT INTO user_settings (user_id, key, value, created_at, updated_at)
      VALUES (${userId}, ${key}, ${toStore}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, key) DO UPDATE SET value = ${toStore}, updated_at = CURRENT_TIMESTAMP
    `
  } else {
    await prisma.setting.upsert({
      where: { key },
      update: { value: toStore, updated_at: new Date() },
      create: { key, value: toStore, created_at: new Date(), updated_at: new Date() },
    })
  }
  revalidatePath("/configuracion")
}

export async function updateSettings(settings: { key: string; value: string }[]): Promise<void> {
  const userId = await getCurrentUserId()
  if (userId) {
    for (const setting of settings) {
      if (setting.key === "ai_api_key" && setting.value === "__MASKED__") continue
      const toStore = encryptIfNeeded(setting.key, setting.value)
      await sql`
        INSERT INTO user_settings (user_id, key, value, created_at, updated_at)
        VALUES (${userId}, ${setting.key}, ${toStore}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, key) DO UPDATE SET value = ${toStore}, updated_at = CURRENT_TIMESTAMP
      `
    }
  } else {
    for (const setting of settings) {
      if (setting.key === "ai_api_key" && setting.value === "__MASKED__") continue
      const toStore = encryptIfNeeded(setting.key, setting.value)
      await prisma.setting.upsert({
        where: { key: setting.key },
        update: { value: toStore, updated_at: new Date() },
        create: { key: setting.key, value: toStore, created_at: new Date(), updated_at: new Date() },
      })
    }
  }
  revalidatePath("/configuracion")
}
