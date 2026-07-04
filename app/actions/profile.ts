"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import bcrypt from "bcryptjs"

export async function updateProfile(data: { name: string; email: string }): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Debes iniciar sesión")

  const email = String(data.email || "").trim().toLowerCase()
  const name = String(data.name || "").trim()
  if (!email) throw new Error("El email es obligatorio")
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email no válido")

  const existing = await sql<{ id: number }>`
    SELECT id FROM users WHERE email = ${email} AND id <> ${userId} LIMIT 1
  `
  if (existing.length) throw new Error("Ese email ya está en uso por otra cuenta")

  await sql`
    UPDATE users SET name = ${name || null}, email = ${email} WHERE id = ${userId}
  `
  revalidatePath("/perfil")
  revalidatePath("/")
}

export async function changePassword(data: {
  currentPassword: string
  newPassword: string
}): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Debes iniciar sesión")

  if (!data.newPassword || data.newPassword.length < 6) {
    throw new Error("La nueva contraseña debe tener al menos 6 caracteres")
  }

  const rows = await sql<{ password_hash: string }>`
    SELECT password_hash FROM users WHERE id = ${userId} LIMIT 1
  `
  const u = rows[0]
  if (!u) throw new Error("Usuario no encontrado")

  const ok = await bcrypt.compare(data.currentPassword || "", u.password_hash)
  if (!ok) throw new Error("La contraseña actual es incorrecta")

  const hash = await bcrypt.hash(data.newPassword, 10)
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${userId}`
}
