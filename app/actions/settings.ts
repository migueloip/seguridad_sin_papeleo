"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import crypto from "crypto"

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
    return rows.map((s: { id: number; key: string; value: string | null; description: string | null }): Setting => ({
      id: s.id,
      key: s.key,
      value: s.key === "ai_api_key" && s.value ? "__MASKED__" : s.value ?? null,
      description: s.description ?? null,
    }))
  } catch {
    return []
  }
}

export async function getSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } })
    const raw = row?.value ?? null
    return decryptIfNeeded(key, raw)
  } catch {
    return null
  }
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const toStore = encryptIfNeeded(key, value)
  await prisma.setting.upsert({
    where: { key },
    update: { value: toStore, updated_at: new Date() },
    create: { key, value: toStore, created_at: new Date(), updated_at: new Date() },
  })
  revalidatePath("/configuracion")
}

export async function updateSettings(settings: { key: string; value: string }[]): Promise<void> {
  for (const setting of settings) {
    if (setting.key === "ai_api_key" && setting.value === "__MASKED__") continue
    const toStore = encryptIfNeeded(setting.key, setting.value)
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: toStore, updated_at: new Date() },
      create: { key: setting.key, value: toStore, created_at: new Date(), updated_at: new Date() },
    })
  }
  revalidatePath("/configuracion")
}
