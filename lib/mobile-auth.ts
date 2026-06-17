import { sql, tenantContext } from "@/lib/db"

export type MobileSession = {
  user_id: number
  email: string
  name: string | null
  role: string | null
}

export async function getMobileSessionFromRequest(req: Request): Promise<MobileSession | null> {
  const auth = req.headers.get("authorization") || ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim() || ""
  if (!token) return null
  try {
    const rows = await sql<MobileSession>`
      SELECT s.user_id, u.email, u.name, u.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `
    const session = rows[0] || null
    if (session) {
      // Fija el contexto de tenant para el resto del request (ver lib/db.ts).
      tenantContext.enterWith({ userId: Number(session.user_id) })
    }
    return session
  } catch {
    return null
  }
}

