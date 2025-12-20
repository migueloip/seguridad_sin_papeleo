"use server"

import { sql } from "@/lib/db"
import type { Worker } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { formatRut, normalizeRut, isValidRut } from "@/lib/utils"

let workerStatsSchemaEnsured: Promise<void> | null = null

async function ensureWorkerStatsSchema() {
  if (!workerStatsSchemaEnsured) {
    workerStatsSchemaEnsured = (async () => {
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS worker_stats_daily (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            stat_date DATE NOT NULL,
            total_workers INTEGER NOT NULL DEFAULT 0,
            complete_workers INTEGER NOT NULL DEFAULT 0,
            incomplete_workers INTEGER NOT NULL DEFAULT 0,
            critical_workers INTEGER NOT NULL DEFAULT 0,
            total_admonitions INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `
        await sql`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_stats_daily_user_date
          ON worker_stats_daily(user_id, stat_date)
        `
      } catch {}
    })()
  }
  await workerStatsSchemaEnsured
}

export type WorkerRow = Worker & {
  project_name: string | null
  valid_docs: number
  expiring_docs: number
  expired_docs: number
  admonitions_count: number
}

type WorkerStatsDailyRow = {
  stat_date: Date
  total_workers: number
  complete_workers: number
  incomplete_workers: number
  critical_workers: number
  total_admonitions: number
}

type WorkerStatsTimelineMode = "day" | "week" | "month"

type WorkerStatsTimelineRow = {
  bucket: string | Date
  total_workers: number
  complete_workers: number
  incomplete_workers: number
  critical_workers: number
  total_admonitions: number
}

function normalizeBucket(raw: string | Date): string {
  if (typeof raw === "string") {
    if (raw.length >= 10) return raw.slice(0, 10)
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return raw
  }
  return new Date(raw).toISOString().slice(0, 10)
}

async function snapshotWorkerStatsForToday(): Promise<WorkerStatsDailyRow | null> {
  const userId = await getCurrentUserId()
  if (!userId) return null
  await ensureWorkerStatsSchema()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const existing = await sql<WorkerStatsDailyRow>`
    SELECT stat_date, total_workers, complete_workers, incomplete_workers, critical_workers, total_admonitions
    FROM worker_stats_daily
    WHERE user_id = ${userId} AND stat_date = ${today}
    LIMIT 1
  `
  if (existing[0]) return existing[0]

  const workers = await getWorkers()
  const totalWorkers = workers.length
  let completeWorkers = 0
  let incompleteWorkers = 0
  let criticalWorkers = 0
  let totalAdmonitions = 0

  for (const w of workers) {
    const valid = Number((w as WorkerRow).valid_docs || 0)
    const expiring = Number((w as WorkerRow).expiring_docs || 0)
    const expired = Number((w as WorkerRow).expired_docs || 0)
    const totalDocs = valid + expiring + expired
    let status: "completo" | "incompleto" | "critico"
    if (expired > 0) {
      status = "critico"
    } else if (expiring > 0 || totalDocs === 0) {
      status = "incompleto"
    } else {
      status = "completo"
    }
    if (status === "critico") {
      criticalWorkers += 1
    } else if (status === "completo") {
      completeWorkers += 1
    } else {
      incompleteWorkers += 1
    }
    totalAdmonitions += Number((w as WorkerRow).admonitions_count || 0)
  }

  const inserted = await sql<WorkerStatsDailyRow>`
    INSERT INTO worker_stats_daily (
      user_id,
      stat_date,
      total_workers,
      complete_workers,
      incomplete_workers,
      critical_workers,
      total_admonitions
    )
    VALUES (
      ${userId},
      ${today},
      ${totalWorkers},
      ${completeWorkers},
      ${incompleteWorkers},
      ${criticalWorkers},
      ${totalAdmonitions}
    )
    ON CONFLICT (user_id, stat_date)
    DO UPDATE SET
      total_workers = EXCLUDED.total_workers,
      complete_workers = EXCLUDED.complete_workers,
      incomplete_workers = EXCLUDED.incomplete_workers,
      critical_workers = EXCLUDED.critical_workers,
      total_admonitions = EXCLUDED.total_admonitions
    RETURNING stat_date, total_workers, complete_workers, incomplete_workers, critical_workers, total_admonitions
  `
  return inserted[0] || null
}

export async function getWorkerStatsTimeline(
  mode: WorkerStatsTimelineMode,
): Promise<WorkerStatsTimelineRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  await ensureWorkerStatsSchema()
  await snapshotWorkerStatsForToday()

  if (mode === "day") {
    const rows = await sql<WorkerStatsTimelineRow>`
      SELECT
        stat_date as bucket,
        total_workers,
        complete_workers,
        incomplete_workers,
        critical_workers,
        total_admonitions
      FROM worker_stats_daily
      WHERE user_id = ${userId}
        AND stat_date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY stat_date
    `
    return rows.map((r) => ({
      bucket: normalizeBucket(r.bucket),
      total_workers: Number(r.total_workers || 0),
      complete_workers: Number(r.complete_workers || 0),
      incomplete_workers: Number(r.incomplete_workers || 0),
      critical_workers: Number(r.critical_workers || 0),
      total_admonitions: Number(r.total_admonitions || 0),
    }))
  }

  if (mode === "week") {
    const rows = await sql<WorkerStatsTimelineRow>`
      SELECT
        date_trunc('week', stat_date)::date as bucket,
        AVG(total_workers)::int as total_workers,
        AVG(complete_workers)::int as complete_workers,
        AVG(incomplete_workers)::int as incomplete_workers,
        AVG(critical_workers)::int as critical_workers,
        AVG(total_admonitions)::int as total_admonitions
      FROM worker_stats_daily
      WHERE user_id = ${userId}
        AND stat_date >= CURRENT_DATE - INTERVAL '12 weeks'
      GROUP BY date_trunc('week', stat_date)
      ORDER BY bucket
    `
    return rows.map((r) => ({
      bucket: normalizeBucket(r.bucket),
      total_workers: Number(r.total_workers || 0),
      complete_workers: Number(r.complete_workers || 0),
      incomplete_workers: Number(r.incomplete_workers || 0),
      critical_workers: Number(r.critical_workers || 0),
      total_admonitions: Number(r.total_admonitions || 0),
    }))
  }

  const rows = await sql<WorkerStatsTimelineRow>`
    SELECT
      date_trunc('month', stat_date)::date as bucket,
      AVG(total_workers)::int as total_workers,
      AVG(complete_workers)::int as complete_workers,
      AVG(incomplete_workers)::int as incomplete_workers,
      AVG(critical_workers)::int as critical_workers,
      AVG(total_admonitions)::int as total_admonitions
    FROM worker_stats_daily
    WHERE user_id = ${userId}
      AND stat_date >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY date_trunc('month', stat_date)
    ORDER BY bucket
  `
  return rows.map((r) => ({
    bucket: normalizeBucket(r.bucket),
    total_workers: Number(r.total_workers || 0),
    complete_workers: Number(r.complete_workers || 0),
    incomplete_workers: Number(r.incomplete_workers || 0),
    critical_workers: Number(r.critical_workers || 0),
    total_admonitions: Number(r.total_admonitions || 0),
  }))
}

export async function getWorkers(projectId?: number) {
  const userId = await getCurrentUserId()
  if (!userId) return []
  if (projectId) {
    return sql<WorkerRow>`
      SELECT w.*, p.name as project_name,
        (SELECT COUNT(*)::int FROM documents d WHERE d.worker_id = w.id AND d.status = 'valid' AND d.user_id = ${userId}) as valid_docs,
        (SELECT COUNT(*)::int FROM documents d WHERE d.worker_id = w.id AND d.status = 'expiring' AND d.user_id = ${userId}) as expiring_docs,
        (SELECT COUNT(*)::int FROM documents d WHERE d.worker_id = w.id AND d.status = 'expired' AND d.user_id = ${userId}) as expired_docs,
        (SELECT COUNT(*)::int FROM admonitions a WHERE a.worker_id = w.id AND a.user_id = ${userId}) as admonitions_count
      FROM workers w
      LEFT JOIN projects p ON w.project_id = p.id
      WHERE w.project_id = ${projectId} AND w.user_id = ${userId}
      ORDER BY w.last_name, w.first_name
    `
  }

  return sql<WorkerRow>`
    SELECT w.*, p.name as project_name,
      (SELECT COUNT(*)::int FROM documents d WHERE d.worker_id = w.id AND d.status = 'valid' AND d.user_id = ${userId}) as valid_docs,
      (SELECT COUNT(*)::int FROM documents d WHERE d.worker_id = w.id AND d.status = 'expiring' AND d.user_id = ${userId}) as expiring_docs,
      (SELECT COUNT(*)::int FROM documents d WHERE d.worker_id = w.id AND d.status = 'expired' AND d.user_id = ${userId}) as expired_docs,
      (SELECT COUNT(*)::int FROM admonitions a WHERE a.worker_id = w.id AND a.user_id = ${userId}) as admonitions_count
    FROM workers w
    LEFT JOIN projects p ON w.project_id = p.id
    WHERE w.user_id = ${userId}
    ORDER BY w.last_name, w.first_name
  `
}

export async function getWorkerById(id: number): Promise<Worker | undefined> {
  const userId = await getCurrentUserId()
  const result = await sql<Worker>`
    SELECT w.*, p.name as project_name
    FROM workers w
    LEFT JOIN projects p ON w.project_id = p.id
    WHERE w.id = ${id} AND w.user_id = ${userId}
  `
  return result[0]
}

export async function createWorker(data: {
  rut: string
  first_name: string
  last_name: string
  role?: string
  company?: string
  phone?: string
  email?: string
  project_id?: number
}) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para crear personal")
  }
  const norm = normalizeRut(data.rut)
  if (!isValidRut(norm)) {
    throw new Error("RUT inválido")
  }
  const existingForUser = await sql<Worker>`
    SELECT * FROM workers 
    WHERE user_id = ${userId}
      AND regexp_replace(upper(rut), '[^0-9K]', '', 'g') = regexp_replace(${norm.toUpperCase()}, '[^0-9K]', '', 'g')
      AND project_id IS NOT DISTINCT FROM ${data.project_id || null}
    LIMIT 1
  `
  if (existingForUser[0]) {
    throw new Error(`El RUT ${formatRut(norm)} ya existe en este proyecto`)
  }
  try {
    const result = await sql`
      INSERT INTO workers (rut, first_name, last_name, role, company, phone, email, project_id, user_id)
      VALUES (${formatRut(norm)}, ${data.first_name}, ${data.last_name}, ${data.role || null}, 
              ${data.company || null}, ${data.phone || null}, ${data.email || null}, ${data.project_id || null}, ${userId})
      RETURNING *
    `
    revalidatePath("/personal")
    if (data.project_id) {
      revalidatePath(`/proyectos/${data.project_id}/personal`)
    }
    revalidatePath("/")
    return result[0]
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("Key (rut)=") && message.includes("already exists")) {
      throw new Error(`El RUT ${formatRut(norm)} ya existe en este proyecto`)
    }
    throw error
  }
}

export async function updateWorker(
  id: number,
  data: Partial<{
    rut: string
    first_name: string
    last_name: string
    role: string
    company: string
    phone: string
    email: string
    project_id: number
    status: string
  }>,
) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para actualizar personal")
  }
  const current = await sql<{ project_id: number | null }>`
    SELECT project_id FROM workers WHERE id = ${id} AND user_id = ${userId} LIMIT 1
  `
  const targetProjectId = (data.project_id ?? (current[0]?.project_id ?? null)) as number | null
  if (data.rut) {
    const norm = normalizeRut(data.rut)
    if (!isValidRut(norm)) {
      throw new Error("RUT inválido")
    }
    const existsOtherForUser = await sql<{ id: number }>`
      SELECT id FROM workers 
      WHERE user_id = ${userId}
        AND regexp_replace(upper(rut), '[^0-9K]', '', 'g') = regexp_replace(${normalizeRut(data.rut).toUpperCase()}, '[^0-9K]', '', 'g')
        AND project_id IS NOT DISTINCT FROM ${targetProjectId}
        AND id <> ${id}
      LIMIT 1
    `
    if (existsOtherForUser[0]) {
      throw new Error(`El RUT ${formatRut(norm)} ya existe en este proyecto`)
    }
  }
  const result = await sql`
    UPDATE workers
    SET 
      rut = COALESCE(${data.rut ? formatRut(normalizeRut(data.rut)) : null}, rut),
      first_name = COALESCE(${data.first_name || null}, first_name),
      last_name = COALESCE(${data.last_name || null}, last_name),
      role = COALESCE(${data.role || null}, role),
      company = COALESCE(${data.company || null}, company),
      phone = COALESCE(${data.phone || null}, phone),
      email = COALESCE(${data.email || null}, email),
      project_id = COALESCE(${data.project_id || null}, project_id),
      status = COALESCE(${data.status || null}, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `
  revalidatePath("/personal")
  return result[0]
}

export async function deleteWorker(id: number) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para eliminar personal")
  }
  await sql`DELETE FROM workers WHERE id = ${id} AND user_id = ${userId}`
  revalidatePath("/personal")
}
