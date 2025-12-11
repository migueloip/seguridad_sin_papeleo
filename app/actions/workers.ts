"use server"

import { sql } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function getWorkers(projectId?: number) {
  if (projectId) {
    return sql`
      SELECT w.*, p.name as project_name,
        (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'valid') as valid_docs,
        (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'expiring') as expiring_docs,
        (SELECT COUNT(*) FROM documents d WHERE d.worker_id = w.id AND d.status = 'expired') as expired_docs
      FROM workers w
      LEFT JOIN projects p ON w.project_id = p.id
      WHERE w.project_id = ${projectId}
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
    ORDER BY w.last_name, w.first_name
  `
}

export async function getWorkerById(id: number) {
  const result = await sql`
    SELECT w.*, p.name as project_name
    FROM workers w
    LEFT JOIN projects p ON w.project_id = p.id
    WHERE w.id = ${id}
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
  const result = await sql`
    INSERT INTO workers (rut, first_name, last_name, role, company, phone, email, project_id)
    VALUES (${data.rut}, ${data.first_name}, ${data.last_name}, ${data.role || null}, 
            ${data.company || null}, ${data.phone || null}, ${data.email || null}, ${data.project_id || null})
    RETURNING *
  `
  revalidatePath("/personal")
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
  const result = await sql`
    UPDATE workers
    SET 
      rut = COALESCE(${data.rut || null}, rut),
      first_name = COALESCE(${data.first_name || null}, first_name),
      last_name = COALESCE(${data.last_name || null}, last_name),
      role = COALESCE(${data.role || null}, role),
      company = COALESCE(${data.company || null}, company),
      phone = COALESCE(${data.phone || null}, phone),
      email = COALESCE(${data.email || null}, email),
      project_id = COALESCE(${data.project_id || null}, project_id),
      status = COALESCE(${data.status || null}, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
    RETURNING *
  `
  revalidatePath("/personal")
  return result[0]
}

export async function deleteWorker(id: number) {
  await sql`DELETE FROM workers WHERE id = ${id}`
  revalidatePath("/personal")
}
