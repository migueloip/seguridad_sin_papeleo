import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getSetting } from "@/app/actions/settings"

export async function GET() {
  const result: { db: "ok" | "error"; aiConfigured: boolean; admonitionsExists?: boolean } = {
    db: "ok",
    aiConfigured: false,
  }
  try {
    await sql`SELECT 1`
  } catch (e: unknown) {
    // Endpoint público: el detalle del error (host, usuario, etc.) solo va al log.
    console.error("[health] error de base de datos:", e)
    result.db = "error"
  }
  try {
    const rows = await sql<{ exists: boolean }[]>`
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
