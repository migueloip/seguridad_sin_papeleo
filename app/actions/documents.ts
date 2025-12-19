"use server"

import { sql } from "@/lib/db"
import type { Worker, DocumentType, Document } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { formatRut, normalizeRut, isValidRut } from "@/lib/utils"

function extFromMime(m: string) {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "application/pdf": "pdf",
  }
  return map[m] || "bin"
}

async function uploadBase64ToSupabase(bucket: string, path: string, dataUrl: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL || ""
  const key = process.env.SUPABASE_SERVICE_KEY || ""
  if (!url || !key || !dataUrl.startsWith("data:")) return null
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return null
  const mime = m[1]
  const b64 = m[2]
  const body = Buffer.from(b64, "base64")
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": mime,
      "x-upsert": "true",
    },
    body,
  })
  if (!res.ok) return null
  return `${url}/storage/v1/object/public/${bucket}/${path}`
}

export async function getDocuments(workerId?: number): Promise<
  Array<Document & { first_name: string; last_name: string; rut: string | null; document_type: string }>
> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  if (workerId) {
    return sql<Document & { first_name: string; last_name: string; rut: string | null; document_type: string }>`
      SELECT d.*, w.first_name, w.last_name, w.rut, dt.name as document_type
      FROM documents d
      JOIN workers w ON d.worker_id = w.id
      LEFT JOIN document_types dt ON d.document_type_id = dt.id
      WHERE d.worker_id = ${workerId} AND d.user_id = ${userId}
      ORDER BY d.expiry_date ASC
    `
  }

  return sql<Document & { first_name: string; last_name: string; rut: string | null; document_type: string }>`
    SELECT d.*, w.first_name, w.last_name, w.rut, dt.name as document_type
    FROM documents d
    JOIN workers w ON d.worker_id = w.id
    LEFT JOIN document_types dt ON d.document_type_id = dt.id
    WHERE d.user_id = ${userId}
    ORDER BY d.expiry_date ASC
  `
}

export async function getDocumentTypes(): Promise<DocumentType[]> {
  return sql<DocumentType>`SELECT * FROM document_types ORDER BY name`
}

export async function createDocument(data: {
  worker_id: number
  document_type_id: number
  file_name: string
  file_url?: string
  issue_date?: string
  expiry_date?: string
  extracted_data?: Record<string, unknown>
}): Promise<Document> {
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

  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para crear documentos")
  }
  let toStoreUrl = data.file_url || null
  if (toStoreUrl && toStoreUrl.startsWith("data:")) {
    const m = toStoreUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (m) {
      const mime = m[1]
      const ext = extFromMime(mime)
      const safeName = String(data.file_name || "archivo").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-")
      const file = `${Date.now()}-${safeName}`.replace(/\.+$/, "")
      const path = `documents/${userId}/${file}${safeName.includes(".") ? "" : `.${ext}`}`
      const uploaded = await uploadBase64ToSupabase("files", path, toStoreUrl)
      if (uploaded) toStoreUrl = uploaded
    }
  }
  const result = await sql<Document>`
    INSERT INTO documents (worker_id, document_type_id, file_name, file_url, issue_date, expiry_date, status, extracted_data, user_id)
    VALUES (${data.worker_id}, ${data.document_type_id}, ${data.file_name}, ${toStoreUrl},
            ${data.issue_date || null}, ${data.expiry_date || null}, ${status}, ${data.extracted_data ? JSON.stringify(data.extracted_data) : null}::jsonb, ${userId})
    RETURNING *
  `
  const [wp] = await sql<{ project_id: number | null }>`SELECT project_id FROM workers WHERE id = ${data.worker_id} LIMIT 1`
  revalidatePath("/documentos")
  if (wp?.project_id) {
    revalidatePath(`/proyectos/${wp.project_id}/documentos`)
  }
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
  project_id?: number
}): Promise<Worker> {
  // First try to find existing worker
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para vincular personal")
  }
  const normInput = normalizeRut(data.rut)
  if (!isValidRut(normInput)) {
    throw new Error("RUT inválido")
  }
  const existing = await sql<Worker>`
    SELECT * FROM workers 
    WHERE regexp_replace(upper(rut), '[^0-9K]', '', 'g') = regexp_replace(${normInput.toUpperCase()}, '[^0-9K]', '', 'g')
      AND user_id = ${userId}
      AND project_id IS NOT DISTINCT FROM ${data.project_id || null}
    LIMIT 1
  `

  if (existing.length > 0) {
    return existing[0]
  }

  // Create new worker
  const result = await sql<Worker>`
    INSERT INTO workers (rut, first_name, last_name, company, role, project_id, user_id)
    VALUES (${formatRut(normInput)}, ${data.first_name}, ${data.last_name}, ${data.company || null}, ${data.role || null}, ${data.project_id || null}, ${userId})
    RETURNING *
  `
  revalidatePath("/personal")
  if (data.project_id) {
    revalidatePath(`/proyectos/${data.project_id}/personal`)
  }
  return result[0]
}

export async function findDocumentTypeByName(name: string): Promise<DocumentType | null> {
  const result = await sql<DocumentType>`
    SELECT * FROM document_types 
    WHERE LOWER(name) LIKE ${`%${name.toLowerCase()}%`}
    LIMIT 1
  `
  return result[0] || null
}

export async function updateDocumentStatus() {
  const userId = await getCurrentUserId()
  await sql`
    UPDATE documents
    SET status = CASE
      WHEN expiry_date IS NULL THEN 'valid'
      WHEN expiry_date < CURRENT_DATE THEN 'expired'
      WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring'
      ELSE 'valid'
    END,
    updated_at = CURRENT_TIMESTAMP
    WHERE expiry_date IS NOT NULL AND user_id = ${userId}
  `
  revalidatePath("/documentos")
}

export async function deleteDocument(id: number) {
  const userId = await getCurrentUserId()
  await sql`DELETE FROM documents WHERE id = ${id} AND user_id = ${userId}`
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
  const userId = await getCurrentUserId()
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
      extracted_data = COALESCE(${data.extracted_data ? JSON.stringify(data.extracted_data) : null}::jsonb, extracted_data),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `
  revalidatePath("/documentos")
  revalidatePath("/")
  return result[0]
}

export async function getDocumentsByProject(projectId: number): Promise<
  Array<Document & { first_name: string; last_name: string; rut: string | null; document_type: string; project_id: number }>
> {
  const userId = await getCurrentUserId()
  return sql<Document & { first_name: string; last_name: string; rut: string | null; document_type: string; project_id: number }>`
    SELECT d.*, w.first_name, w.last_name, w.rut, w.project_id, dt.name as document_type
    FROM documents d
    JOIN workers w ON d.worker_id = w.id
    LEFT JOIN document_types dt ON d.document_type_id = dt.id
    WHERE w.project_id = ${projectId} AND d.user_id = ${userId}
    ORDER BY d.expiry_date ASC
  `
}
