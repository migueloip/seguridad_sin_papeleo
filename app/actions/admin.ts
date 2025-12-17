"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import type { User } from "@/lib/db"
import { revalidatePath } from "next/cache"

function getAdminSecret() {
  const rawHash = process.env.ADMIN_PASSWORD_HASH || ""
  const rawPlain = process.env.ADMIN_PASSWORD || ""
  const sanitize = (v: string) => v.trim().replace(/^['"]|['"]$/g, "")
  const hash = sanitize(rawHash)
  const plain = sanitize(rawPlain)
  return { hash, plain }
}

export async function isAdminAuthenticated() {
  const cookieStore = await cookies()
  const token = cookieStore.get("admin_auth")?.value
  return Boolean(token)
}

export async function adminLogin(formData: FormData) {
  const password = String(formData.get("password") || "").trim()
  const { hash, plain } = getAdminSecret()
  if (!hash && !plain) {
    return redirect("/admin?error=not_configured")
  }
  let ok = false
  if (hash) {
    ok = await bcrypt.compare(password, hash)
  } else if (plain) {
    ok = password === plain
  }
  if (!ok) {
    return redirect("/admin?error=invalid")
  }
  const cookieStore = await cookies()
  cookieStore.set("admin_auth", crypto.randomUUID(), {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60,
  })
  redirect("/admin/usuarios")
}

export async function adminLogout() {
  const cookieStore = await cookies()
  cookieStore.set("admin_auth", "", { path: "/", maxAge: 0 })
  redirect("/admin")
}

export async function getAllUsers(): Promise<Array<Pick<User, "id" | "email" | "name" | "role">>> {
  const rows = await sql<Pick<User, "id" | "email" | "name" | "role">>`SELECT id, email, name, role FROM users ORDER BY created_at DESC`
  return rows
}

export async function createUser(formData: FormData) {
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
  await sql`DELETE FROM users WHERE id = ${userId}`
  revalidatePath("/admin/usuarios")
}
