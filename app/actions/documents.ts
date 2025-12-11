"use server"

import { sql } from "@/lib/db"
import { revalidatePath } from "next/cache"

export async function getDocuments(workerId?: number) {
  if (workerId) {
    return sql`
      SELECT d.*, w.first_name, w.last_name, w.rut, dt.name as document_type
      FROM documents d
      JOIN workers w ON d.worker_id = w.id
      LEFT JOIN document_types dt ON d.document_type_id = dt.id
      WHERE d.worker_id = ${workerId}
      ORDER BY d.expiry_date ASC
    `
  }

  return sql`
    SELECT d.*, w.first_name, w.last_name, w.rut, dt.name as document_type
    FROM documents d
    JOIN workers w ON d.worker_id = w.id
    LEFT JOIN document_types dt ON d.document_type_id = dt.id
    ORDER BY d.expiry_date ASC
  `
}

export async function getDocumentTypes() {
  return sql`SELECT * FROM document_types ORDER BY name`
}

export async function createDocument(data: {
  worker_id: number
  document_type_id: number
  file_name: string
  file_url?: string
  issue_date?: string
  expiry_date?: string
  extracted_data?: Record<string, unknown>
}) {
  // Calculate status based on expiry date
  let status = "valid"
  if (data.expiry_date) {
    const expiryDate = new Date(data.expiry_date)
    const today = new Date()
    const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

    if (expiryDate < today) {
      status = "expired"
    } else if (expiryDate <= thirtyDaysFromNow) {
      status = "expiring"
    }
  }

  const result = await sql`
    INSERT INTO documents (worker_id, document_type_id, file_name, file_url, issue_date, expiry_date, status, extracted_data)
    VALUES (${data.worker_id}, ${data.document_type_id}, ${data.file_name}, ${data.file_url || null},
            ${data.issue_date || null}, ${data.expiry_date || null}, ${status}, ${JSON.stringify(data.extracted_data) || null})
    RETURNING *
  `
  revalidatePath("/documentos")
  revalidatePath("/subir")
  revalidatePath("/")
  return result[0]
}

export async function findOrCreateWorkerByRut(data: {
  rut: string
  first_name: string
  last_name: string
  company?: string
  role?: string
}) {
  // First try to find existing worker
  const existing = await sql`
    SELECT * FROM workers WHERE rut = ${data.rut} LIMIT 1
  `

  if (existing.length > 0) {
    return existing[0]
  }

  // Create new worker
  const result = await sql`
    INSERT INTO workers (rut, first_name, last_name, company, role)
    VALUES (${data.rut}, ${data.first_name}, ${data.last_name}, ${data.company || null}, ${data.role || null})
    RETURNING *
  `
  revalidatePath("/personal")
  return result[0]
}

export async function findDocumentTypeByName(name: string) {
  const result = await sql`
    SELECT * FROM document_types 
    WHERE LOWER(name) LIKE ${`%${name.toLowerCase()}%`}
    LIMIT 1
  `
  return result[0] || null
}

export async function updateDocumentStatus() {
  await sql`
    UPDATE documents
    SET status = CASE
      WHEN expiry_date IS NULL THEN 'valid'
      WHEN expiry_date < CURRENT_DATE THEN 'expired'
      WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring'
      ELSE 'valid'
    END,
    updated_at = CURRENT_TIMESTAMP
    WHERE expiry_date IS NOT NULL
  `
  revalidatePath("/documentos")
}

export async function deleteDocument(id: number) {
  await sql`DELETE FROM documents WHERE id = ${id}`
  revalidatePath("/documentos")
}

export async function updateDocument(
  id: number,
  data: Partial<{
    worker_id: number
    document_type_id: number
    file_name: string
    file_url: string
    issue_date: string
    expiry_date: string
    extracted_data: Record<string, unknown>
  }>,
) {
  // Recalculate status if expiry_date provided
  const result = await sql`
    UPDATE documents
    SET 
      worker_id = COALESCE(${data.worker_id || null}, worker_id),
      document_type_id = COALESCE(${data.document_type_id || null}, document_type_id),
      file_name = COALESCE(${data.file_name || null}, file_name),
      file_url = COALESCE(${data.file_url || null}, file_url),
      issue_date = COALESCE(${data.issue_date || null}, issue_date),
      expiry_date = COALESCE(${data.expiry_date || null}, expiry_date),
      status = CASE
        WHEN COALESCE(${data.expiry_date || null}, expiry_date) IS NULL THEN status
        WHEN COALESCE(${data.expiry_date || null}, expiry_date) < CURRENT_DATE THEN 'expired'
        WHEN COALESCE(${data.expiry_date || null}, expiry_date) <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring'
        ELSE 'valid'
      END,
      extracted_data = COALESCE(${data.extracted_data ? JSON.stringify(data.extracted_data) : null}, extracted_data),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
    RETURNING *
  `
  revalidatePath("/documentos")
  revalidatePath("/")
  return result[0]
}
