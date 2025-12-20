import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"
import { getSession } from "@/lib/auth"

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    if ((session.role || "user") !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 })
    const body = await req.json()
    const email = String(body.email || "").trim().toLowerCase()
    const password = String(body.password || "")
    const name = body.name ? String(body.name).trim() : null
    const role = body.role ? String(body.role).trim().toLowerCase() : undefined

    if (!email || !password) {
      return NextResponse.json({ error: "Email y contraseña son obligatorios" }, { status: 400 })
    }

    const existing = await sql<{ id: number; role: string }>`SELECT id, role FROM users WHERE email = ${email} LIMIT 1`
    if (existing.length) {
      if (role && role !== existing[0].role) {
        await sql`UPDATE users SET role = ${role} WHERE id = ${existing[0].id}`
      }
      return NextResponse.json({ ok: true, message: "Usuario ya existe", user_id: Number(existing[0].id) })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const result = await sql<{ id: number }>`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${email}, ${name || null}, ${passwordHash}, ${role || "user"})
      RETURNING id
    `
    const userId = Number(result[0].id)

    await sql`UPDATE projects SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE workers SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE documents SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE findings SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE completed_checklists SET user_id = ${userId} WHERE user_id IS NULL`
    await sql`UPDATE reports SET user_id = ${userId} WHERE user_id IS NULL`

    return NextResponse.json({ ok: true, user_id: userId }, { status: 201 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear usuario"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
