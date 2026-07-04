"use server"

import { sql } from "@/lib/db"
import type { User } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"
import { createSession, destroySession } from "@/lib/auth"

// Retry wrapper for database operations (handles Neon connection drops)
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, delayMs = 1000): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      const errorMessage = String(error)
      const isConnectionError =
        errorMessage.includes("Server has closed the connection") ||
        errorMessage.includes("Connection terminated") ||
        errorMessage.includes("Tenant or user not found") ||
        errorMessage.includes("terminating connection") ||
        errorMessage.includes("P1017")

      if (isConnectionError && attempt < maxRetries) {
        console.warn(`Database connection error (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        continue
      }
      throw error
    }
  }
  throw lastError
}

/**
 * Asigna registros huérfanos (user_id NULL) al primer admin que se registra en
 * el sistema. Se ejecuta SOLO durante el primer register cuando la tabla users
 * está vacía — adoptar datos pre-existentes de antes de la migración 004.
 *
 * Antes esto se ejecutaba en CADA login/register, lo cual era inseguro (race
 * condition entre usuarios) y lento (UPDATE masivo en cada login).
 */
async function adoptOrphanDataIfFirstUser(userId: number) {
  const userCount = await withRetry(async () =>
    await sql<{ count: string }>`SELECT COUNT(*)::text AS count FROM users WHERE id <> ${userId}`,
  )
  if (Number(userCount[0]?.count ?? "0") > 0) return
  await withRetry(async () => {
    await sql`UPDATE projects SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE workers SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE documents SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE findings SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE completed_checklists SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE reports SET user_id = ${userId} WHERE user_id IS NULL`
  })
}

export type AuthFormState = { error: string; values?: { name?: string; email?: string } } | null

export async function register(formData: FormData) {
  const result = await registerAction(null, formData)
  if (result?.error) throw new Error(result.error)
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const name = String(formData.get("name") || "").trim()
  const password = String(formData.get("password") || "")
  const confirm = formData.get("confirm")
  const fail = (error: string): AuthFormState => ({ error, values: { name, email } })

  if (!email || !password) {
    return fail("Email y contraseña son obligatorios")
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail("El email no tiene un formato válido")
  }
  if (password.length < 8) {
    return fail("La contraseña debe tener al menos 8 caracteres")
  }
  if (confirm !== null && String(confirm) !== password) {
    return fail("Las contraseñas no coinciden")
  }

  let existing: { id: number }[]
  try {
    existing = await withRetry(async () => await sql<{ id: number }>`SELECT id FROM users WHERE email = ${email} LIMIT 1`)
  } catch {
    return fail("No se pudo conectar con el servidor. Intenta de nuevo.")
  }
  if (existing.length) {
    return fail("Este email ya está registrado")
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  const role = adminEmails.includes(email) ? "admin" : "user"
  let result: { id: number; role: string | null }[]
  try {
    result = await withRetry(async () => await sql<{ id: number; role: string | null }>`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${email}, ${name || null}, ${passwordHash}, ${role})
      RETURNING id, role
    `)
  } catch {
    return fail("No se pudo crear la cuenta. Intenta de nuevo.")
  }
  const userId = Number(result[0].id)
  await createSession(userId)
  await adoptOrphanDataIfFirstUser(userId)
  const createdRole = result[0].role || "user"
  redirect(createdRole === "admin" ? "/admin" : "/")
}

export async function login(formData: FormData) {
  const result = await loginAction(null, formData)
  if (result?.error) throw new Error(result.error)
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const password = String(formData.get("password") || "")
  const fail = (error: string): AuthFormState => ({ error, values: { email } })

  if (!email || !password) {
    return fail("Email y contraseña son obligatorios")
  }

  let user: User[]
  try {
    user = await withRetry(async () => await sql<User>`SELECT * FROM users WHERE email = ${email} LIMIT 1`)
  } catch {
    return fail("No se pudo conectar con el servidor. Intenta de nuevo.")
  }
  const u = user[0]
  if (!u) {
    return fail("Credenciales inválidas")
  }
  const ok = await bcrypt.compare(password, u.password_hash)
  if (!ok) {
    return fail("Credenciales inválidas")
  }

  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (adminEmails.includes(email) && u.role !== "admin") {
    await withRetry(async () => await sql`UPDATE users SET role = 'admin' WHERE id = ${u.id}`)
    u.role = "admin"
  }

  await createSession(Number(u.id))
  redirect((u.role || "user") === "admin" ? "/admin" : "/")
}

export async function logout() {
  await destroySession()
  revalidatePath("/")
}
