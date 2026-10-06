"use server"

import { sql } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { getCurrentUserId } from "@/lib/auth"
import {
  decryptSettingIfNeeded as decryptIfNeeded,
  encryptSettingIfNeeded as encryptIfNeeded,
  readSetting,
  SENSITIVE_SETTING_KEYS,
} from "@/lib/settings"

// IMPORTANTE: cada export de este archivo es un endpoint público (server action).
// Nada de aquí puede devolver claves sensibles descifradas (API key de IA, clave SMTP):
// para usarlas en el servidor, importar readSetting/getAiSettings de "@/lib/settings".

export interface Setting {
  id: number
  key: string
  value: string | null
  description: string | null
}

/** Valor que ve el navegador en lugar de una clave sensible guardada. */
const MASKED = "__MASKED__"

function maskIfSensitive(key: string, value: string | null): string | null {
  return SENSITIVE_SETTING_KEYS.has(key) && value ? MASKED : value
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
        value: maskIfSensitive(s.key, v),
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
          value: maskIfSensitive(o.key, v),
          description: ex.description,
        })
      } else {
        byKey.set(o.key, {
          id: o.id,
          key: o.key,
          value: maskIfSensitive(o.key, v),
          description: o.description ?? null,
        })
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key))
  } catch {
    return []
  }
}

/**
 * Valor de una clave de configuración para el usuario de la sesión. Es una
 * acción pública (la usa el sidebar): las claves sensibles no se devuelven.
 */
export async function getSetting(key: string): Promise<string | null> {
  if (typeof key !== "string" || SENSITIVE_SETTING_KEYS.has(key)) return null
  return readSetting(key)
}

export async function updateSetting(key: string, value: string): Promise<void> {
  if (SENSITIVE_SETTING_KEYS.has(key) && value === MASKED) return
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
    if (SENSITIVE_SETTING_KEYS.has(setting.key) && setting.value === MASKED) continue
    const toStore = encryptIfNeeded(setting.key, setting.value)
    await sql`
      INSERT INTO settings (user_id, key, value, created_at, updated_at)
      VALUES (${userId}, ${setting.key}, ${toStore}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, key) DO UPDATE SET value = ${toStore}, updated_at = CURRENT_TIMESTAMP
    `
  }
  revalidatePath("/configuracion")
}
