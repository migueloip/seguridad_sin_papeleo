"use server"

import { sql } from "@/lib/db"
import type { Worker, DocumentType, Document } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { formatRut, normalizeRut, isValidRut } from "@/lib/utils"
import { extractDocumentData } from "./document-processing"
import { documentTypes as defaultDocumentTypes } from "@/app/data/document-types"

export type DocumentAnalytics = {
  total: number
  valid: number
  expiring: number
  expired: number
  no_expiry: number
  avg_days_to_expiry: number | null
  avg_days_expired: number | null
  top_types: Array<{
    name: string
    total: number
    expired: number
    expiring: number
  }>
  oldest_expired: {
    id: number
    file_name: string
    worker_name: string
    document_type: string
    expiry_date: string
    days_expired: number
  } | null
}

export type MobileDocumentCandidate = {
  mobile_document_id: number
  photo_index: number
  project_name: string | null
  title: string
  description: string | null
  created_at: string
  file_name: string
}

type DocumentTimelineMode = "day" | "week" | "month"

type DocumentTimelineRow = {
  bucket: string | Date
  issued_count: number
  expiry_count: number
}

export type ExtractedDocumentData = {
  rut: string | null
  nombre: string | null
  fechaEmision: string | null
  fechaVencimiento: string | null
  tipoDocumento: string | null
  empresa: string | null
  cargo: string | null
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
  const existing = await sql<DocumentType>`SELECT * FROM document_types ORDER BY name`
  const existingNames = new Set(existing.map((dt) => dt.name.toLowerCase()))

  const inserted: DocumentType[] = []
  for (const dt of defaultDocumentTypes) {
    if (existingNames.has(dt.name.toLowerCase())) continue
    const rows = await sql<DocumentType>`
      INSERT INTO document_types (name, description, validity_days, is_mandatory)
      VALUES (${dt.name}, NULL, ${dt.validity_days}, false)
      RETURNING *
    `
    if (rows[0]) {
      inserted.push(rows[0])
      existingNames.add(rows[0].name.toLowerCase())
    }
  }

  const all = [...existing, ...inserted]
  return all.sort((a, b) => a.name.localeCompare(b.name))
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
  const issueDateParam = data.issue_date ? new Date(data.issue_date) : null
  const expiryDateParam = data.expiry_date ? new Date(data.expiry_date) : null
  const result = await sql<Document>`
    INSERT INTO documents (worker_id, document_type_id, file_name, file_url, issue_date, expiry_date, status, extracted_data, user_id)
    VALUES (${data.worker_id}, ${data.document_type_id}, ${data.file_name}, ${toStoreUrl},
            ${issueDateParam}, ${expiryDateParam}, ${status}, ${data.extracted_data ? JSON.stringify(data.extracted_data) : null}::jsonb, ${userId})
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

export async function getDocumentsTimeline(
  mode: DocumentTimelineMode,
  projectId?: number,
): Promise<DocumentTimelineRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const projectParam = projectId ?? null

  if (mode === "day") {
    const issuedRows = await sql<{ bucket: string | Date; count: number }>`
      SELECT date_trunc('day', d.issue_date)::date as bucket, COUNT(*)::int as count
      FROM documents d
      LEFT JOIN workers w ON d.worker_id = w.id
      WHERE
        d.issue_date IS NOT NULL
        AND d.user_id = ${userId}
        AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
        AND d.issue_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY date_trunc('day', d.issue_date)
      ORDER BY bucket
    `
    const expiryRows = await sql<{ bucket: string | Date; count: number }>`
      SELECT date_trunc('day', d.expiry_date)::date as bucket, COUNT(*)::int as count
      FROM documents d
      LEFT JOIN workers w ON d.worker_id = w.id
      WHERE
        d.expiry_date IS NOT NULL
        AND d.user_id = ${userId}
        AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
        AND d.expiry_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY date_trunc('day', d.expiry_date)
      ORDER BY bucket
    `
    const map = new Map<
      string,
      {
        issued_count: number
        expiry_count: number
      }
    >()
    for (const r of issuedRows || []) {
      const key = normalizeBucket(r.bucket)
      const prev = map.get(key) || { issued_count: 0, expiry_count: 0 }
      prev.issued_count += Number(r.count || 0)
      map.set(key, prev)
    }
    for (const r of expiryRows || []) {
      const key = normalizeBucket(r.bucket)
      const prev = map.get(key) || { issued_count: 0, expiry_count: 0 }
      prev.expiry_count += Number(r.count || 0)
      map.set(key, prev)
    }
    const entries = Array.from(map.entries())
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return entries.map(([bucket, v]) => ({
      bucket,
      issued_count: v.issued_count,
      expiry_count: v.expiry_count,
    }))
  }

  if (mode === "week") {
    const issuedRows = await sql<{ bucket: string | Date; count: number }>`
      SELECT date_trunc('week', d.issue_date)::date as bucket, COUNT(*)::int as count
      FROM documents d
      LEFT JOIN workers w ON d.worker_id = w.id
      WHERE
        d.issue_date IS NOT NULL
        AND d.user_id = ${userId}
        AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
        AND d.issue_date >= CURRENT_DATE - INTERVAL '12 weeks'
      GROUP BY date_trunc('week', d.issue_date)
      ORDER BY bucket
    `
    const expiryRows = await sql<{ bucket: string | Date; count: number }>`
      SELECT date_trunc('week', d.expiry_date)::date as bucket, COUNT(*)::int as count
      FROM documents d
      LEFT JOIN workers w ON d.worker_id = w.id
      WHERE
        d.expiry_date IS NOT NULL
        AND d.user_id = ${userId}
        AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
        AND d.expiry_date >= CURRENT_DATE - INTERVAL '12 weeks'
      GROUP BY date_trunc('week', d.expiry_date)
      ORDER BY bucket
    `
    const map = new Map<
      string,
      {
        issued_count: number
        expiry_count: number
      }
    >()
    for (const r of issuedRows || []) {
      const key = normalizeBucket(r.bucket)
      const prev = map.get(key) || { issued_count: 0, expiry_count: 0 }
      prev.issued_count += Number(r.count || 0)
      map.set(key, prev)
    }
    for (const r of expiryRows || []) {
      const key = normalizeBucket(r.bucket)
      const prev = map.get(key) || { issued_count: 0, expiry_count: 0 }
      prev.expiry_count += Number(r.count || 0)
      map.set(key, prev)
    }
    const entries = Array.from(map.entries())
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return entries.map(([bucket, v]) => ({
      bucket,
      issued_count: v.issued_count,
      expiry_count: v.expiry_count,
    }))
  }

  const issuedRows = await sql<{ bucket: string | Date; count: number }>`
    SELECT date_trunc('month', d.issue_date)::date as bucket, COUNT(*)::int as count
    FROM documents d
    LEFT JOIN workers w ON d.worker_id = w.id
    WHERE
      d.issue_date IS NOT NULL
      AND d.user_id = ${userId}
      AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
      AND d.issue_date >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY date_trunc('month', d.issue_date)
    ORDER BY bucket
  `
  const expiryRows = await sql<{ bucket: string | Date; count: number }>`
    SELECT date_trunc('month', d.expiry_date)::date as bucket, COUNT(*)::int as count
    FROM documents d
    LEFT JOIN workers w ON d.worker_id = w.id
    WHERE
      d.expiry_date IS NOT NULL
      AND d.user_id = ${userId}
      AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
      AND d.expiry_date >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY date_trunc('month', d.expiry_date)
    ORDER BY bucket
  `
  const map = new Map<
    string,
    {
      issued_count: number
      expiry_count: number
    }
  >()
  for (const r of issuedRows || []) {
    const key = normalizeBucket(r.bucket)
    const prev = map.get(key) || { issued_count: 0, expiry_count: 0 }
    prev.issued_count += Number(r.count || 0)
    map.set(key, prev)
  }
  for (const r of expiryRows || []) {
    const key = normalizeBucket(r.bucket)
    const prev = map.get(key) || { issued_count: 0, expiry_count: 0 }
    prev.expiry_count += Number(r.count || 0)
    map.set(key, prev)
  }
  const entries = Array.from(map.entries())
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return entries.map(([bucket, v]) => ({
    bucket,
    issued_count: v.issued_count,
      expiry_count: v.expiry_count,
    }))
}

export async function getDocumentAnalytics(projectId?: number): Promise<DocumentAnalytics> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      total: 0,
      valid: 0,
      expiring: 0,
      expired: 0,
      no_expiry: 0,
      avg_days_to_expiry: null,
      avg_days_expired: null,
      top_types: [],
      oldest_expired: null,
    }
  }
  const projectParam = projectId ?? null

  const countRows = await sql<{
    total: number
    valid: number
    expiring: number
    expired: number
    no_expiry: number
  }>`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE d.status = 'valid')::int as valid,
      COUNT(*) FILTER (WHERE d.status = 'expiring')::int as expiring,
      COUNT(*) FILTER (WHERE d.status = 'expired')::int as expired,
      COUNT(*) FILTER (WHERE d.expiry_date IS NULL)::int as no_expiry
    FROM documents d
    LEFT JOIN workers w ON d.worker_id = w.id
    WHERE
      d.user_id = ${userId}
      AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
  `
  const counts = countRows[0] || {
    total: 0,
    valid: 0,
    expiring: 0,
    expired: 0,
    no_expiry: 0,
  }

  const avgToExpiryRows = await sql<{ avg_days: number | null }>`
    SELECT AVG(EXTRACT(EPOCH FROM (d.expiry_date::timestamp - CURRENT_DATE::timestamp)) / 86400.0) as avg_days
    FROM documents d
    LEFT JOIN workers w ON d.worker_id = w.id
    WHERE
      d.expiry_date IS NOT NULL
      AND d.expiry_date > CURRENT_DATE
      AND d.user_id = ${userId}
      AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
  `
  const avgExpiredRows = await sql<{ avg_days: number | null }>`
    SELECT AVG(EXTRACT(EPOCH FROM (CURRENT_DATE::timestamp - d.expiry_date::timestamp)) / 86400.0) as avg_days
    FROM documents d
    LEFT JOIN workers w ON d.worker_id = w.id
    WHERE
      d.expiry_date IS NOT NULL
      AND d.expiry_date < CURRENT_DATE
      AND d.user_id = ${userId}
      AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
  `
  const avg_days_to_expiry =
    avgToExpiryRows[0] && avgToExpiryRows[0].avg_days !== null && avgToExpiryRows[0].avg_days !== undefined
      ? Number(avgToExpiryRows[0].avg_days)
      : null
  const avg_days_expired =
    avgExpiredRows[0] && avgExpiredRows[0].avg_days !== null && avgExpiredRows[0].avg_days !== undefined
      ? Number(avgExpiredRows[0].avg_days)
      : null

  const topTypeRows = await sql<{
    name: string | null
    total: number
    expired: number
    expiring: number
  }>`
    SELECT
      COALESCE(dt.name, 'Sin tipo') as name,
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE d.status = 'expired')::int as expired,
      COUNT(*) FILTER (WHERE d.status = 'expiring')::int as expiring
    FROM documents d
    LEFT JOIN workers w ON d.worker_id = w.id
    LEFT JOIN document_types dt ON d.document_type_id = dt.id
    WHERE
      d.user_id = ${userId}
      AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
    GROUP BY COALESCE(dt.name, 'Sin tipo')
    ORDER BY expired DESC, expiring DESC, total DESC
    LIMIT 5
  `
  const top_types =
    topTypeRows?.map((r) => ({
      name: r.name || "Sin tipo",
      total: Number(r.total || 0),
      expired: Number(r.expired || 0),
      expiring: Number(r.expiring || 0),
    })) || []

  let oldest_expired: DocumentAnalytics["oldest_expired"] = null
  if (counts.expired > 0) {
    const rows = await sql<{
      id: number
      file_name: string
      expiry_date: Date
      first_name: string | null
      last_name: string | null
      document_type: string | null
    }>`
      SELECT
        d.id,
        d.file_name,
        d.expiry_date,
        w.first_name,
        w.last_name,
        dt.name as document_type
      FROM documents d
      LEFT JOIN workers w ON d.worker_id = w.id
      LEFT JOIN document_types dt ON d.document_type_id = dt.id
      WHERE
        d.status = 'expired'
        AND d.user_id = ${userId}
        AND (${projectParam}::int IS NULL OR w.project_id = ${projectParam}::int)
      ORDER BY d.expiry_date ASC
      LIMIT 1
    `
    const row = rows[0]
    if (row) {
      const exp =
        row.expiry_date instanceof Date ? row.expiry_date : new Date(String(row.expiry_date))
      const now = new Date()
      const days = Math.floor((now.getTime() - exp.getTime()) / (1000 * 60 * 60 * 24))
      oldest_expired = {
        id: Number(row.id),
        file_name: String(row.file_name),
        worker_name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Sin nombre",
        document_type: row.document_type || "Sin tipo",
        expiry_date: exp.toISOString().slice(0, 10),
        days_expired: days,
      }
    }
  }

  return {
    total: Number(counts.total || 0),
    valid: Number(counts.valid || 0),
    expiring: Number(counts.expiring || 0),
    expired: Number(counts.expired || 0),
    no_expiry: Number(counts.no_expiry || 0),
    avg_days_to_expiry,
    avg_days_expired,
    top_types,
    oldest_expired,
  }
}

export async function getMobileDocumentCandidates(projectId?: number): Promise<MobileDocumentCandidate[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const projectParam = projectId ?? null

  const rows = await sql<{
    mobile_document_id: number
    project_name: string | null
    title: string
    description: string | null
    photos: unknown
    created_at: string
  }>`
    SELECT
      m.id as mobile_document_id,
      p.name as project_name,
      m.title,
      m.description,
      m.photos,
      m.created_at::text as created_at
    FROM mobile_documents m
    LEFT JOIN projects p ON m.project_id = p.id
    WHERE
      (${projectParam}::int IS NULL OR m.project_id = ${projectParam}::int)
      AND m.user_id = ${userId}
      AND m.photos IS NOT NULL
    ORDER BY m.created_at DESC
  `

  const candidates: MobileDocumentCandidate[] = []

  for (const row of rows || []) {
    const rawPhotos = row.photos
    let photos: string[] = []
    if (Array.isArray(rawPhotos)) {
      photos = rawPhotos.filter((p): p is string => typeof p === "string")
    } else if (typeof rawPhotos === "string" && rawPhotos) {
      try {
        const parsed = JSON.parse(rawPhotos)
        if (Array.isArray(parsed)) {
          photos = parsed.filter((p): p is string => typeof p === "string")
        } else {
          photos = [rawPhotos]
        }
      } catch {
        photos = [rawPhotos]
      }
    }

    for (let i = 0; i < photos.length; i += 1) {
      const img = photos[i]
      let ext = "jpg"
      if (typeof img === "string" && img.startsWith("data:")) {
        const match = img.match(/^data:([^;]+);base64,/)
        if (match && match[1]) {
          ext = extFromMime(match[1])
        }
      }
      const baseNameSource = row.title || "documento-movil"
      const safeName = baseNameSource
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80)
        .replace(/^-|-$/g, "")
      const fileNameBase = safeName || "documento-movil"
      const fileName =
        photos.length > 1 ? `${fileNameBase}-${i + 1}.${ext}` : `${fileNameBase}.${ext}`
      candidates.push({
        mobile_document_id: Number(row.mobile_document_id),
        photo_index: i,
        project_name: row.project_name,
        title: row.title,
        description: row.description,
        created_at: String(row.created_at),
        file_name: fileName,
      })
    }
  }

  return candidates
}

export async function createDocumentFromMobilePhoto(input: {
  mobile_document_id: number
  photo_index: number
  worker_id: number
  document_type_id: number
  issue_date?: string
  expiry_date?: string
  file_name?: string
  extracted_data?: Record<string, unknown>
}): Promise<Document> {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para crear documentos")
  }

  const rows = await sql<{
    title: string
    photos: unknown
  }>`
    SELECT
      m.title,
      m.photos
    FROM mobile_documents m
    WHERE
      m.id = ${input.mobile_document_id}
      AND m.user_id = ${userId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) {
    throw new Error("No se encontró la imagen seleccionada")
  }

  const rawPhotos = row.photos
  let photos: string[] = []
  if (Array.isArray(rawPhotos)) {
    photos = rawPhotos.filter((p): p is string => typeof p === "string")
  } else if (typeof rawPhotos === "string" && rawPhotos) {
    try {
      const parsed = JSON.parse(rawPhotos)
      if (Array.isArray(parsed)) {
        photos = parsed.filter((p): p is string => typeof p === "string")
      } else {
        photos = [rawPhotos]
      }
    } catch {
      photos = [rawPhotos]
    }
  }

  const img = photos[input.photo_index]
  if (!img || typeof img !== "string") {
    throw new Error("La imagen seleccionada no está disponible")
  }

  const baseNameSource = row.title || "documento-movil"
  const safeName = baseNameSource
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "")
  let ext = "jpg"
  if (typeof img === "string" && img.startsWith("data:")) {
    const match = img.match(/^data:([^;]+);base64,/)
    if (match && match[1]) {
      ext = extFromMime(match[1])
    }
  }
  const defaultBase = safeName || "documento-movil"
  const defaultFileName =
    photos.length > 1 ? `${defaultBase}-${input.photo_index + 1}.${ext}` : `${defaultBase}.${ext}`
  const fileName = input.file_name && input.file_name.trim() ? input.file_name.trim() : defaultFileName

  const created = await createDocument({
    worker_id: input.worker_id,
    document_type_id: input.document_type_id,
    file_name: fileName,
    file_url: img,
    issue_date: input.issue_date,
    expiry_date: input.expiry_date,
    extracted_data: input.extracted_data,
  })

  return created
}

export async function getMobilePhoto(mobileDocumentId: number, photoIndex: number): Promise<string | null> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return null
  }

  const rows = await sql<{
    photos: unknown
  }>`
    SELECT
      m.photos
    FROM mobile_documents m
    WHERE
      m.id = ${mobileDocumentId}
      AND m.user_id = ${userId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) {
    return null
  }

  const rawPhotos = row.photos
  let photos: string[] = []
  if (Array.isArray(rawPhotos)) {
    photos = rawPhotos.filter((p): p is string => typeof p === "string")
  } else if (typeof rawPhotos === "string" && rawPhotos) {
    try {
      const parsed = JSON.parse(rawPhotos)
      if (Array.isArray(parsed)) {
        photos = parsed.filter((p): p is string => typeof p === "string")
      } else {
        photos = [rawPhotos]
      }
    } catch {
      photos = [rawPhotos]
    }
  }

  const img = photos[photoIndex]
  if (!img || typeof img !== "string") {
    return null
  }
  return img
}

export async function extractDocumentDataFromMobilePhoto(input: {
  mobile_document_id: number
  photo_index: number
}): Promise<ExtractedDocumentData> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      rut: null,
      nombre: null,
      fechaEmision: null,
      fechaVencimiento: null,
      tipoDocumento: null,
      empresa: null,
      cargo: null,
    }
  }

  const rows = await sql<{
    photos: unknown
  }>`
    SELECT
      m.photos
    FROM mobile_documents m
    WHERE
      m.id = ${input.mobile_document_id}
      AND m.user_id = ${userId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) {
    return {
      rut: null,
      nombre: null,
      fechaEmision: null,
      fechaVencimiento: null,
      tipoDocumento: null,
      empresa: null,
      cargo: null,
    }
  }

  const rawPhotos = row.photos
  let photos: string[] = []
  if (Array.isArray(rawPhotos)) {
    photos = rawPhotos.filter((p): p is string => typeof p === "string")
  } else if (typeof rawPhotos === "string" && rawPhotos) {
    try {
      const parsed = JSON.parse(rawPhotos)
      if (Array.isArray(parsed)) {
        photos = parsed.filter((p): p is string => typeof p === "string")
      } else {
        photos = [rawPhotos]
      }
    } catch {
      photos = [rawPhotos]
    }
  }

  const img = photos[input.photo_index]
  if (!img || typeof img !== "string" || !img.startsWith("data:")) {
    return {
      rut: null,
      nombre: null,
      fechaEmision: null,
      fechaVencimiento: null,
      tipoDocumento: null,
      empresa: null,
      cargo: null,
    }
  }

  const match = img.match(/^data:([^;]+);base64,(.+)$/)
  if (!match || !match[1] || !match[2]) {
    return {
      rut: null,
      nombre: null,
      fechaEmision: null,
      fechaVencimiento: null,
      tipoDocumento: null,
      empresa: null,
      cargo: null,
    }
  }

  const mime = match[1]
  const base64 = match[2]
  const data = await extractDocumentData(base64, mime)
  return data
}

export async function deleteMobilePhoto(input: {
  mobile_document_id: number
  photo_index: number
}) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para eliminar fotos")
  }

  const rows = await sql<{
    photos: unknown
  }>`
    SELECT
      m.photos
    FROM mobile_documents m
    WHERE
      m.id = ${input.mobile_document_id}
      AND m.user_id = ${userId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) {
    return
  }

  const rawPhotos = row.photos
  let photos: string[] = []
  if (Array.isArray(rawPhotos)) {
    photos = rawPhotos.filter((p): p is string => typeof p === "string")
  } else if (typeof rawPhotos === "string" && rawPhotos) {
    try {
      const parsed = JSON.parse(rawPhotos)
      if (Array.isArray(parsed)) {
        photos = parsed.filter((p): p is string => typeof p === "string")
      } else {
        photos = [rawPhotos]
      }
    } catch {
      photos = [rawPhotos]
    }
  }

  if (input.photo_index < 0 || input.photo_index >= photos.length) {
    return
  }

  const remaining = photos.filter((_, idx) => idx !== input.photo_index)

  if (remaining.length === 0) {
    await sql`
      UPDATE mobile_documents
      SET photos = NULL
      WHERE id = ${input.mobile_document_id}
        AND user_id = ${userId}
    `
  } else {
    await sql`
      UPDATE mobile_documents
      SET photos = ${JSON.stringify(remaining)}::jsonb
      WHERE id = ${input.mobile_document_id}
        AND user_id = ${userId}
    `
  }

  revalidatePath("/documentos")
  revalidatePath("/")
}
