"use server"

import { sql } from "@/lib/db"
import type { Admonition, AdmonitionAttachment } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"

let schemaEnsured: Promise<void> | null = null

async function ensureAdmonitionsSchema() {
  if (!schemaEnsured) {
    schemaEnsured = (async () => {
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            name VARCHAR(255),
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
        await sql`
          CREATE TABLE IF NOT EXISTS workers (
            id SERIAL PRIMARY KEY,
            rut VARCHAR(20) UNIQUE NOT NULL,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            role VARCHAR(100),
            company VARCHAR(255),
            phone VARCHAR(20),
            email VARCHAR(255),
            project_id INTEGER,
            status VARCHAR(50) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
        await sql`
          CREATE TABLE IF NOT EXISTS admonitions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
            admonition_date DATE NOT NULL,
            admonition_type VARCHAR(50) NOT NULL,
            reason TEXT NOT NULL,
            supervisor_signature TEXT,
            attachments JSONB,
            status VARCHAR(50) DEFAULT 'active',
            approval_status VARCHAR(50) DEFAULT 'pending',
            approved_at TIMESTAMP,
            rejected_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
        await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_user ON admonitions(user_id)`
        await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_worker ON admonitions(worker_id)`
        await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_type ON admonitions(admonition_type)`
        await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_status ON admonitions(status)`
        await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_approval ON admonitions(approval_status)`
        await sql`CREATE INDEX IF NOT EXISTS idx_admonitions_date ON admonitions(admonition_date)`
        await sql`
          CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            type VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT,
            related_id INTEGER,
            related_type VARCHAR(50),
            is_read BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
        await sql`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)`
      } catch {}
    })()
  }
  await schemaEnsured
}

async function getProjectIdForWorker(workerId: number): Promise<number | null> {
  try {
    const rows = await sql<{ project_id: number | null }>`
      SELECT project_id FROM workers WHERE id = ${workerId} LIMIT 1
    `
    return rows[0]?.project_id ?? null
  } catch {
    return null
  }
}

async function getProjectIdForAdmonition(id: number, userId: number): Promise<number | null> {
  try {
    const rows = await sql<{ project_id: number | null }>`
      SELECT w.project_id
      FROM admonitions a
      JOIN workers w ON a.worker_id = w.id
      WHERE a.id = ${id} AND a.user_id = ${userId}
      LIMIT 1
    `
    return rows[0]?.project_id ?? null
  } catch {
    return null
  }
}

type CreateAdmonitionInput = {
  worker_id: number
  admonition_date: string
  admonition_type: "verbal" | "escrita" | "suspension"
  reason: string
  supervisor_signature?: string | null
  attachments?: AdmonitionAttachment[] | null
}

type UpdateAdmonitionInput = Partial<{
  admonition_date: string
  admonition_type: "verbal" | "escrita" | "suspension"
  reason: string
  supervisor_signature: string | null
  attachments: AdmonitionAttachment[] | null
  status: "active" | "archived" | "archivada"
  approval_status: "pending" | "approved" | "rejected"
}>

export async function getAdmonitions(filters?: {
  worker_id?: number
  from?: string
  to?: string
  type?: "verbal" | "escrita" | "suspension" | "todos"
  status?: "active" | "archived" | "archivada" | "todos"
  approval_status?: "pending" | "approved" | "rejected" | "todos"
}): Promise<
  Array<
    Admonition & {
      first_name: string
      last_name: string
      company: string | null
      role: string | null
    }
  >
> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  await ensureAdmonitionsSchema()
  const workerIdParam = filters?.worker_id ?? null
  const fromDate = filters?.from ? new Date(filters.from) : null
  const toDate = filters?.to ? new Date(filters.to) : null
  const typeParam = filters?.type && filters.type !== "todos" ? filters.type : null
  const statusParam =
    filters?.status && filters.status !== "todos"
      ? filters.status === "archivada"
        ? "archived"
        : filters.status
      : null
  const approvalParam =
    filters?.approval_status && filters.approval_status !== "todos" ? filters.approval_status : null

  const rows = await sql<
    Admonition & { first_name: string; last_name: string; company: string | null; role: string | null }
  >`
    SELECT a.*, w.first_name, w.last_name, w.company, w.role
    FROM admonitions a
    JOIN workers w ON a.worker_id = w.id
    WHERE a.user_id = ${userId}
      AND (${workerIdParam}::int IS NULL OR a.worker_id = ${workerIdParam}::int)
      AND (${fromDate}::date IS NULL OR a.admonition_date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR a.admonition_date <= ${toDate}::date)
      AND (${typeParam}::text IS NULL OR a.admonition_type = ${typeParam}::text)
      AND (${statusParam}::text IS NULL OR a.status = ${statusParam}::text)
      AND (${approvalParam}::text IS NULL OR a.approval_status = ${approvalParam}::text)
    ORDER BY a.admonition_date DESC, a.created_at DESC
  `
  return rows
}

export async function createAdmonition(data: CreateAdmonitionInput): Promise<Admonition> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Debes iniciar sesión")
  await ensureAdmonitionsSchema()
  if (!data.worker_id) throw new Error("Trabajador requerido")
  if (!data.admonition_date) throw new Error("Fecha requerida")
  if (!["verbal", "escrita", "suspension"].includes(data.admonition_type)) throw new Error("Tipo inválido")
  if (!data.reason || !data.reason.trim()) throw new Error("Motivo requerido")

  const result = await sql<Admonition>`
    INSERT INTO admonitions (user_id, worker_id, admonition_date, admonition_type, reason, supervisor_signature, attachments, status, approval_status, created_at, updated_at)
    VALUES (${userId}, ${data.worker_id}, ${new Date(data.admonition_date)}, ${data.admonition_type}, ${data.reason},
            ${data.supervisor_signature || null},
            ${data.attachments ? JSON.stringify(data.attachments) : null}::jsonb,
            'active', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING *
  `
  const inserted = result[0]

  try {
    await sql`
      INSERT INTO notifications (type, title, message, related_id, related_type, is_read)
      VALUES ('admonition_pending', 'Nueva amonestación pendiente', ${`Amonestación para el trabajador #${data.worker_id}`}, ${inserted.id}, 'admonition', false)
    `
  } catch {}

  revalidatePath("/personal")
  const projectId = await getProjectIdForWorker(data.worker_id)
  if (projectId) {
    revalidatePath(`/proyectos/${projectId}/personal`)
  }
  return inserted
}

export async function updateAdmonition(id: number, data: UpdateAdmonitionInput): Promise<Admonition> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Debes iniciar sesión")
  await ensureAdmonitionsSchema()
  const approval = data.approval_status || null
  const status = data.status || null
  const res = await sql<Admonition>`
    UPDATE admonitions
    SET
      admonition_date = COALESCE(${data.admonition_date ? new Date(data.admonition_date) : null}, admonition_date),
      admonition_type = COALESCE(${data.admonition_type || null}, admonition_type),
      reason = COALESCE(${data.reason || null}, reason),
      supervisor_signature = COALESCE(${data.supervisor_signature || null}, supervisor_signature),
      attachments = COALESCE(${data.attachments ? JSON.stringify(data.attachments) : null}::jsonb, attachments),
      status = COALESCE(${status}, status),
      approval_status = COALESCE(${approval}, approval_status),
      approved_at = CASE WHEN ${approval} = 'approved' THEN CURRENT_TIMESTAMP ELSE approved_at END,
      rejected_at = CASE WHEN ${approval} = 'rejected' THEN CURRENT_TIMESTAMP ELSE rejected_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `
  const updated = res[0]

  if (approval === "approved") {
    try {
      await sql`
        INSERT INTO notifications (type, title, message, related_id, related_type, is_read)
        VALUES ('admonition_approved', 'Amonestación aprobada', ${`La amonestación #${id} fue aprobada`}, ${id}, 'admonition', false)
      `
    } catch {}
  } else if (approval === "rejected") {
    try {
      await sql`
        INSERT INTO notifications (type, title, message, related_id, related_type, is_read)
        VALUES ('admonition_rejected', 'Amonestación rechazada', ${`La amonestación #${id} fue rechazada`}, ${id}, 'admonition', false)
      `
    } catch {}
  }

  revalidatePath("/personal")
  const projectId = await getProjectIdForAdmonition(id, userId)
  if (projectId) {
    revalidatePath(`/proyectos/${projectId}/personal`)
  }
  return updated
}

export async function archiveAdmonition(id: number): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Debes iniciar sesión")
  await ensureAdmonitionsSchema()
  await sql`
    UPDATE admonitions
    SET status = 'archived', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND user_id = ${userId}
  `
  revalidatePath("/personal")
  const projectId = await getProjectIdForAdmonition(id, userId)
  if (projectId) {
    revalidatePath(`/proyectos/${projectId}/personal`)
  }
}

export async function deleteAdmonition(id: number): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("Debes iniciar sesión")
  await ensureAdmonitionsSchema()
  const projectId = await getProjectIdForAdmonition(id, userId)
  await sql`DELETE FROM admonitions WHERE id = ${id} AND user_id = ${userId}`
  revalidatePath("/personal")
  if (projectId) {
    revalidatePath(`/proyectos/${projectId}/personal`)
  }
}

export async function getAdmonitionStats(params?: { from?: string; to?: string }) {
  const userId = await getCurrentUserId()
  if (!userId) return { byDepartment: [], byType: [], byMonth: [] }
  await ensureAdmonitionsSchema()
  const fromDate = params?.from ? new Date(params.from) : null
  const toDate = params?.to ? new Date(params.to) : null
  const byDepartment = await sql<{ department: string | null; total: number }>`
    SELECT w.company as department, COUNT(*) as total
    FROM admonitions a
    JOIN workers w ON a.worker_id = w.id
    WHERE a.user_id = ${userId}
      AND (${fromDate}::date IS NULL OR a.admonition_date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR a.admonition_date <= ${toDate}::date)
    GROUP BY w.company
    ORDER BY total DESC
  `
  const byType = await sql<{ admonition_type: string; total: number }>`
    SELECT admonition_type, COUNT(*) as total
    FROM admonitions a
    WHERE a.user_id = ${userId}
      AND (${fromDate}::date IS NULL OR a.admonition_date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR a.admonition_date <= ${toDate}::date)
    GROUP BY admonition_type
    ORDER BY total DESC
  `
  const byMonth = await sql<{ month: string; total: number }>`
    SELECT to_char(admonition_date, 'YYYY-MM') as month, COUNT(*) as total
    FROM admonitions a
    WHERE a.user_id = ${userId}
      AND (${fromDate}::date IS NULL OR a.admonition_date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR a.admonition_date <= ${toDate}::date)
    GROUP BY to_char(admonition_date, 'YYYY-MM')
    ORDER BY month DESC
  `
  return { byDepartment, byType, byMonth }
}
