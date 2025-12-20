import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { sql } from "@/lib/db"

type UserRow = {
  id: number
  email: string
  name: string | null
  password_hash: string
  role: string | null
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null
    const email = String(body?.email || "").trim().toLowerCase()
    const password = String(body?.password || "")
    if (!email || !password) {
      return NextResponse.json({ error: "email y contraseña son obligatorios" }, { status: 400 })
    }

    const rows = await sql<UserRow>`SELECT * FROM users WHERE email = ${email} LIMIT 1`
    const u = rows[0]
    if (!u) return NextResponse.json({ error: "credenciales inválidas" }, { status: 401 })

    const ok = await bcrypt.compare(password, u.password_hash)
    if (!ok) return NextResponse.json({ error: "credenciales inválidas" }, { status: 401 })

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await sql`INSERT INTO sessions (user_id, token, expires_at) VALUES (${u.id}, ${token}, ${expiresAt})`

    return NextResponse.json({ token, expires_at: expiresAt.toISOString() })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
