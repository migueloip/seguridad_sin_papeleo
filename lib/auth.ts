import { cookies } from "next/headers"
import { sql } from "@/lib/db"

type SessionWithUser = {
  user_id: number
  email: string
  name: string | null
  role: string | null
}

export async function getSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get("session_token")?.value
  if (!token) return null
  try {
    const result = await sql<SessionWithUser>`
      SELECT s.*, u.email, u.name, u.role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ${token} AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `
    return result[0] || null
  } catch {
    return null
  }
}

export async function getCurrentUserId(): Promise<number | null> {
  const session = await getSession()
  return session?.user_id ?? null
}

export async function createSession(userId: number) {
  const token = crypto.randomUUID()
  // 7 days expiry
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await sql`
    INSERT INTO sessions (user_id, token, expires_at)
    VALUES (${userId}, ${token}, ${expiresAt})
  `
  const cookieStore = await cookies()
  cookieStore.set("session_token", token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
  })
}

export async function destroySession() {
  const cookieStore = await cookies()
  const token = cookieStore.get("session_token")?.value
  if (token) {
    await sql`DELETE FROM sessions WHERE token = ${token}`
    cookieStore.set("session_token", "", { path: "/", maxAge: 0 })
  }
}
