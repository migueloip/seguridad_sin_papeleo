import { NextResponse } from "next/server"

export async function GET() {
  const hash = (process.env.ADMIN_PASSWORD_HASH || "").trim() !== ""
  const plain = (process.env.ADMIN_PASSWORD || "").trim() !== ""
  return NextResponse.json({ configured: hash || plain, hash, plain })
}
