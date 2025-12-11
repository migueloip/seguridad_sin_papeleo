"use server"

import { sql } from "@/lib/db"
import type { User } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"
import { createSession, destroySession } from "@/lib/auth"

async function backfillUserId(userId: number) {
  await sql`UPDATE projects SET user_id = ${userId} WHERE user_id IS NULL`
  await sql`UPDATE workers SET user_id = ${userId} WHERE user_id IS NULL`
  await sql`UPDATE documents SET user_id = ${userId} WHERE user_id IS NULL`
  await sql`UPDATE findings SET user_id = ${userId} WHERE user_id IS NULL`
  await sql`UPDATE completed_checklists SET user_id = ${userId} WHERE user_id IS NULL`
  await sql`UPDATE reports SET user_id = ${userId} WHERE user_id IS NULL`
}

export async function register(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const name = String(formData.get("name") || "").trim()
  const password = String(formData.get("password") || "")

  if (!email || !password) {
    throw new Error("Email y contraseña son obligatorios")
  }

  const existing = await sql<{ id: number }>`SELECT id FROM users WHERE email = ${email} LIMIT 1`
  if (existing.length) {
    throw new Error("Este email ya está registrado")
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  const role = adminEmails.includes(email) ? "admin" : "user"
  const result = await sql<{ id: number; role: string | null }>`
    INSERT INTO users (email, name, password_hash, role)
    VALUES (${email}, ${name || null}, ${passwordHash}, ${role})
    RETURNING id, role
  `
  const userId = Number(result[0].id)
  await createSession(userId)
  await backfillUserId(userId)
  const createdRole = result[0].role || "user"
  redirect(createdRole === "admin" ? "/admin" : "/")
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const password = String(formData.get("password") || "")

  if (!email || !password) {
    throw new Error("Email y contraseña son obligatorios")
  }

  const user = await sql<User>`SELECT * FROM users WHERE email = ${email} LIMIT 1`
  const u = user[0]
  if (!u) {
    throw new Error("Credenciales inválidas")
  }
  const ok = await bcrypt.compare(password, u.password_hash)
  if (!ok) {
    throw new Error("Credenciales inválidas")
  }

  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (adminEmails.includes(email) && u.role !== "admin") {
    await sql`UPDATE users SET role = 'admin' WHERE id = ${u.id}`
    u.role = "admin"
  }

  await createSession(Number(u.id))
  await backfillUserId(Number(u.id))
  redirect((u.role || "user") === "admin" ? "/admin" : "/")
}

export async function logout() {
  await destroySession()
  revalidatePath("/")
}
