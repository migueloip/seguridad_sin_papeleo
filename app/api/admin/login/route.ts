import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import bcrypt from "bcryptjs"

function sanitize(v: string) {
  return v.trim().replace(/^['"]|['"]$/g, "")
}

export async function POST(req: Request) {
  const form = await req.formData()
  const password = sanitize(String(form.get("password") || ""))
  const rawHash = process.env.ADMIN_PASSWORD_HASH || ""
  const rawPlain = process.env.ADMIN_PASSWORD || ""
  const hash = sanitize(rawHash)
  const plain = sanitize(rawPlain)
  if (!hash && !plain) {
    return NextResponse.redirect(new URL("/admin?error=not_configured", req.url))
  }
  let ok = false
  if (hash) {
    ok = await bcrypt.compare(password, hash)
  } else if (plain) {
    ok = password === plain
  }
  if (!ok) {
    return NextResponse.redirect(new URL("/admin?error=invalid", req.url))
  }
  const jar = await cookies()
  jar.set("admin_auth", crypto.randomUUID(), {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60,
  })
  return NextResponse.redirect(new URL("/admin/usuarios", req.url))
}
