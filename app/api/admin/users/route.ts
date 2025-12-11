import { NextResponse } from "next/server"
import { sql } from "@/lib/db"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const email = String(searchParams.get("email") || "").trim().toLowerCase()
  if (!email) return NextResponse.json({ error: "email requerido" }, { status: 400 })
  const rows = await sql`SELECT id, email, name, created_at FROM users WHERE email = ${email} LIMIT 1`
  if (!rows.length) return NextResponse.json({ exists: false })
  return NextResponse.json({ exists: true, user: rows[0] })
}

