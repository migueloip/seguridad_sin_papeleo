import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSetting } from "@/app/actions/settings"

export async function GET() {
  const result: { db: "ok" | "error"; aiConfigured: boolean; message?: string } = {
    db: "ok",
    aiConfigured: false,
  }
  try {
    await sql`SELECT 1`
  } catch (e: unknown) {
    result.db = "error"
    result.message = e instanceof Error ? e.message : "db error"
  }
  try {
    const key = await getSetting("ai_api_key")
    result.aiConfigured = !!key && key !== ""
  } catch {}
  return NextResponse.json(result)
}
