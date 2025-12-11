"use server"

import { sql } from "@/lib/db"
import { revalidatePath } from "next/cache"

export interface Setting {
  id: number
  key: string
  value: string | null
  description: string | null
}

export async function getSettings(): Promise<Setting[]> {
  const result = await sql`SELECT * FROM settings ORDER BY key`
  return result as Setting[]
}

export async function getSetting(key: string): Promise<string | null> {
  const result = await sql`SELECT value FROM settings WHERE key = ${key}`
  return result[0]?.value || null
}

export async function updateSetting(key: string, value: string): Promise<void> {
  await sql`
    UPDATE settings 
    SET value = ${value}, updated_at = CURRENT_TIMESTAMP 
    WHERE key = ${key}
  `
  revalidatePath("/configuracion")
}

export async function updateSettings(settings: { key: string; value: string }[]): Promise<void> {
  for (const setting of settings) {
    await sql`
      UPDATE settings 
      SET value = ${setting.value}, updated_at = CURRENT_TIMESTAMP 
      WHERE key = ${setting.key}
    `
  }
  revalidatePath("/configuracion")
}
