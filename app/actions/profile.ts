"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import bcrypt from "bcryptjs"
import { isAdminEmail } from "@/lib/admin-emails"
import { hasOpenInvitationForEmail } from "@/lib/obra/server/invitations"

/**
 * Cambia el nombre y el correo de la cuenta. El correo NO se verifica (no se
 * envían confirmaciones), así que no se puede cambiar a uno que da permisos
 * por sí mismo: uno de ADMIN_EMAILS (salvo que ya seas admin) o uno con una
 * invitación pendiente a una obra (si no, cualquiera con el enlace se pondría
 * ese correo, aceptaría y volvería al suyo).
 */
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

  const me = await sql<{ email: string; role: string | null }[]>`SELECT email, role FROM users WHERE id = ${userId} LIMIT 1`
  if (!me[0]) throw new Error("Usuario no encontrado")
  if (String(me[0].email).trim().toLowerCase() !== email) {
    if (isAdminEmail(email) && me[0].role !== "admin") {
      throw new Error("Ese correo está reservado para la administración del sistema: pide el cambio a un administrador.")
    }
    if (await hasOpenInvitationForEmail(email)) {
      throw new Error(
        "Ese correo tiene una invitación pendiente a una obra: acéptala desde su enlace (crea la cuenta de ese correo) o pide que te inviten con tu correo actual.",
      )
    }
  }

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
