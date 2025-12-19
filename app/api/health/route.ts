import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSetting } from "@/app/actions/settings"

export async function GET() {
  const result: { db: "ok" | "error"; aiConfigured: boolean; admonitionsExists?: boolean; message?: string } = {
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
    const rows = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'admonitions'
      ) as exists
    `
    result.admonitionsExists = Boolean(rows[0]?.exists)
  } catch {}
  try {
    const key = await getSetting("ai_api_key")
    result.aiConfigured = !!key && key !== ""
  } catch {}
  return NextResponse.json(result)
}
