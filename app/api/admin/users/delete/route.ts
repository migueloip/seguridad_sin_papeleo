import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { getSession } from "@/lib/auth"

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.redirect(new URL("/auth/login", req.url))
  if ((session.role || "user") !== "admin") return NextResponse.redirect(new URL("/", req.url))
  const data = await req.formData()
  const idStr = String(data.get("id") || "")
  const id = Number.parseInt(idStr, 10)
  if (!Number.isFinite(id)) {
    return NextResponse.redirect(new URL("/admin/usuarios?error=bad_id", req.url))
  }
  await sql`DELETE FROM users WHERE id = ${id}`
  revalidatePath("/admin/usuarios")
  return NextResponse.redirect(new URL("/admin/usuarios", req.url))
}
