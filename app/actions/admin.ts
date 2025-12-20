"use server"

import { redirect } from "next/navigation"
import { sql } from "@/lib/db"
import type { User } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/auth"
import bcrypt from "bcryptjs"

export async function requireAdmin() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  if ((session.role || "user") !== "admin") redirect("/")
  return session
}

export async function getAllUsers(): Promise<Array<Pick<User, "id" | "email" | "name" | "role">>> {
  await requireAdmin()
  const rows = await sql<Pick<User, "id" | "email" | "name" | "role">>`SELECT id, email, name, role FROM users ORDER BY created_at DESC`
  return rows
}

export async function createUser(formData: FormData) {
  await requireAdmin()
  const email = String(formData.get("email") || "").trim().toLowerCase()
  const name = String(formData.get("name") || "").trim()
  const password = String(formData.get("password") || "")
  const role = String(formData.get("role") || "user")
  if (!email || !password) {
    throw new Error("Email y contraseña son obligatorios")
  }
  const existing = await sql<User>`SELECT * FROM users WHERE email = ${email} LIMIT 1`
  if (existing[0]) {
    throw new Error("El usuario ya existe")
  }
  const passwordHash = await bcrypt.hash(password, 10)
  await sql`INSERT INTO users (email, name, password_hash) VALUES (${email}, ${name || null}, ${passwordHash})`
  if (role && role !== "user") {
    const u = await sql<User>`SELECT * FROM users WHERE email = ${email} LIMIT 1`
    if (u[0]) {
      await sql`UPDATE users SET role = ${role} WHERE id = ${u[0].id}`
    }
  }
  revalidatePath("/admin/usuarios")
}

export async function deleteUser(userId: number) {
  await requireAdmin()
  await sql`DELETE FROM users WHERE id = ${userId}`
  revalidatePath("/admin/usuarios")
}
