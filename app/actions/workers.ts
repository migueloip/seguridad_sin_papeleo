"use server"

import { sql } from "@/lib/db"
import type { Worker } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { formatRut, normalizeRut, isValidRut } from "@/lib/utils"

export type WorkerRow = Worker & {
  project_name: string | null
  valid_docs: number
  expiring_docs: number
  expired_docs: number
  admonitions_count: number
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
    revalidatePath("/personal")
    revalidatePath("/")
    return existingForUser[0]
  }
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
