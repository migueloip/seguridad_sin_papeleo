"use server"

import { sql } from "@/lib/db"
import type { Worker } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { formatRut, normalizeRut, isValidRut } from "@/lib/utils"

export async function getWorkers(projectId?: number) {
  const userId = await getCurrentUserId()
  if (!userId) return []
  if (projectId) {
    return sql`
      SELECT w.*, p.name as project_name,
        (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'valid') as valid_docs,
        (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'expiring') as expiring_docs,
        (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'expired') as expired_docs
      FROM workers w
      LEFT JOIN projects p ON w.project_id = p.id
      WHERE w.project_id = ${projectId} AND w.user_id = ${userId}
      ORDER BY w.last_name, w.first_name
    `
  }

  return sql`
    SELECT w.*, p.name as project_name,
      (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'valid') as valid_docs,
      (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'expiring') as expiring_docs,
      (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'expired') as expired_docs
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
    LIMIT 1
  `
  if (existingForUser[0]) {
    revalidatePath("/personal")
    revalidatePath("/")
    return existingForUser[0]
  }
  const existsGlobal = await sql<{ id: number }>`
    SELECT id FROM workers 
    WHERE regexp_replace(upper(rut), '[^0-9K]', '', 'g') = regexp_replace(${norm.toUpperCase()}, '[^0-9K]', '', 'g')
    LIMIT 1
  `
  if (existsGlobal[0]) {
    throw new Error(`El RUT ${formatRut(norm)} ya existe`)
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
  if (data.rut) {
    const norm = normalizeRut(data.rut)
    if (!isValidRut(norm)) {
      throw new Error("RUT inválido")
    }
    const existsOtherForUser = await sql<{ id: number }>`
      SELECT id FROM workers 
      WHERE user_id = ${userId}
        AND regexp_replace(upper(rut), '[^0-9K]', '', 'g') = regexp_replace(${normalizeRut(data.rut).toUpperCase()}, '[^0-9K]', '', 'g')
        AND id <> ${id}
      LIMIT 1
    `
    if (existsOtherForUser[0]) {
      throw new Error(`El RUT ${formatRut(norm)} ya existe en tu cuenta`)
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
