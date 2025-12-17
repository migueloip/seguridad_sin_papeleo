import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function POST(req: Request) {
  const jar = await cookies()
  jar.set("admin_auth", "", { path: "/", maxAge: 0 })
  return NextResponse.redirect(new URL("/admin", req.url))
}
