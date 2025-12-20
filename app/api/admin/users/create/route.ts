import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import type { User } from "@/lib/db"
import bcrypt from "bcryptjs"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/auth"

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.redirect(new URL("/auth/login", req.url))
  if ((session.role || "user") !== "admin") return NextResponse.redirect(new URL("/", req.url))
  const data = await req.formData()
  const email = String(data.get("email") || "").trim().toLowerCase()
  const name = String(data.get("name") || "").trim()
  const password = String(data.get("password") || "")
  const role = String(data.get("role") || "user")
  if (!email || !password) {
    return NextResponse.redirect(new URL("/admin/usuarios?error=missing", req.url))
  }
  const existing = await sql<User>`SELECT * FROM users WHERE email = ${email} LIMIT 1`
  if (existing[0]) {
    return NextResponse.redirect(new URL("/admin/usuarios?error=exists", req.url))
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
  return NextResponse.redirect(new URL("/admin/usuarios", req.url))
}
