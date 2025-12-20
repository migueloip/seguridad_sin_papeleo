"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"

export type FindingRow = {
  id: number
  title: string
  description: string | null
  location: string | null
  responsible_person: string | null
  responsible_worker_id: number | null
  responsible_worker_name: string | null
  severity: string
  status: string
  project_name: string | null
  plan_zone_id: number | null
  plan_zone_name: string | null
  plan_floor_name: string | null
  related_document_type_ids: number[]
  due_date: string | null
  resolution_notes: string | null
  photos: string[] | null
  created_at: string
}

type FindingTimelineMode = "day" | "week" | "month"

type FindingTimelineRow = {
  bucket: string
  created_count: number
  resolved_count: number
}

export type FindingAnalytics = {
  total: number
  open: number
  in_progress: number
  resolved: number
  overdue: number
  avg_resolution_days: number | null
  avg_open_days: number | null
  top_zones: Array<{
    label: string
    floor: string | null
    total: number
    open: number
  }>
  oldest_open: {
    id: number
    title: string
    severity: string
    location: string | null
    project_name: string | null
    plan_zone_name: string | null
    created_at: string
    days_open: number
  } | null
}

type FindingsSchemaSupport = {
  responsible_worker_id: boolean
  plan_zone_id: boolean
  related_document_type_ids: boolean
  plan_zones_table: boolean
  plan_floors_table: boolean
}

let findingsSchemaSupportPromise: Promise<FindingsSchemaSupport> | null = null

async function getFindingsSchemaSupport(): Promise<FindingsSchemaSupport> {
  if (findingsSchemaSupportPromise) return findingsSchemaSupportPromise
  findingsSchemaSupportPromise = (async () => {
    const read = async (): Promise<FindingsSchemaSupport> => {
      const cols = await sql<{ column_name: string }>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'findings'
          AND column_name IN ('responsible_worker_id', 'plan_zone_id', 'related_document_type_ids')
      `
      const set = new Set(cols.map((c) => String(c.column_name)))

      const tables = await sql<{ table_name: string }>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('plan_zones', 'plan_floors')
      `
      const tableSet = new Set(tables.map((t) => String(t.table_name)))

      return {
        responsible_worker_id: set.has("responsible_worker_id"),
        plan_zone_id: set.has("plan_zone_id"),
        related_document_type_ids: set.has("related_document_type_ids"),
        plan_zones_table: tableSet.has("plan_zones"),
        plan_floors_table: tableSet.has("plan_floors"),
      }
    }

    try {
      let support = await read()
      if (!support.responsible_worker_id || !support.plan_zone_id || !support.related_document_type_ids) {
        try {
          if (!support.responsible_worker_id) {
            await sql`ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS responsible_worker_id INTEGER`
          }
          if (!support.plan_zone_id) {
            await sql`ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS plan_zone_id INTEGER`
          }
          if (!support.related_document_type_ids) {
            await sql`ALTER TABLE IF EXISTS findings ADD COLUMN IF NOT EXISTS related_document_type_ids JSONB`
          }
          await sql`CREATE INDEX IF NOT EXISTS idx_findings_responsible_worker ON findings(responsible_worker_id)`
          await sql`CREATE INDEX IF NOT EXISTS idx_findings_plan_zone ON findings(plan_zone_id)`
        } catch {}
        support = await read()
      }
      return support
    } catch {
      return {
        responsible_worker_id: false,
        plan_zone_id: false,
        related_document_type_ids: false,
        plan_zones_table: false,
        plan_floors_table: false,
      }
    }
  })()
  return findingsSchemaSupportPromise
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

function serializeFindingRow(row: Record<string, unknown>): FindingRow {
  const createdAtRaw = row.created_at
  const dueDateRaw = row.due_date
  const resolutionNotesRaw = row.resolution_notes
  const photosRaw = row.photos

  let photos: string[] | null = null
  if (Array.isArray(photosRaw)) {
    photos = photosRaw.filter((p): p is string => typeof p === "string")
  } else if (typeof photosRaw === "string") {
    try {
      const parsed = JSON.parse(photosRaw)
      if (Array.isArray(parsed)) photos = parsed.filter((p): p is string => typeof p === "string")
    } catch {}
  }

  const created_at =
    typeof createdAtRaw === "string"
      ? createdAtRaw
      : createdAtRaw instanceof Date
        ? createdAtRaw.toISOString()
        : ""

  const due_date =
    typeof dueDateRaw === "string"
      ? dueDateRaw
      : dueDateRaw instanceof Date
        ? dueDateRaw.toISOString().slice(0, 10)
        : null

  const rawDocTypeIds = row.related_document_type_ids
  let related_document_type_ids: number[] = []
  if (Array.isArray(rawDocTypeIds)) {
    related_document_type_ids = rawDocTypeIds.map((x) => Number(x)).filter((n) => Number.isFinite(n))
  } else if (typeof rawDocTypeIds === "string") {
    try {
      const parsed = JSON.parse(rawDocTypeIds)
      if (Array.isArray(parsed)) {
        related_document_type_ids = parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n))
      }
    } catch {}
  }

  return {
    id: typeof row.id === "number" ? row.id : Number(row.id),
    title: typeof row.title === "string" ? row.title : "",
    description: typeof row.description === "string" ? row.description : row.description === null ? null : null,
    location: typeof row.location === "string" ? row.location : row.location === null ? null : null,
    responsible_person:
      typeof row.responsible_person === "string"
        ? row.responsible_person
        : row.responsible_person === null
          ? null
          : null,
    responsible_worker_id:
      typeof row.responsible_worker_id === "number"
        ? row.responsible_worker_id
        : row.responsible_worker_id === null || row.responsible_worker_id === undefined
          ? null
          : Number(row.responsible_worker_id),
    responsible_worker_name:
      typeof row.responsible_worker_name === "string"
        ? row.responsible_worker_name
        : row.responsible_worker_name === null
          ? null
          : null,
    severity: typeof row.severity === "string" ? row.severity : "medium",
    status: typeof row.status === "string" ? row.status : "open",
    project_name: typeof row.project_name === "string" ? row.project_name : row.project_name === null ? null : null,
    plan_zone_id:
      typeof row.plan_zone_id === "number"
        ? row.plan_zone_id
        : row.plan_zone_id === null || row.plan_zone_id === undefined
          ? null
          : Number(row.plan_zone_id),
    plan_zone_name:
      typeof row.plan_zone_name === "string" ? row.plan_zone_name : row.plan_zone_name === null ? null : null,
    plan_floor_name:
      typeof row.plan_floor_name === "string" ? row.plan_floor_name : row.plan_floor_name === null ? null : null,
    related_document_type_ids,
    due_date,
    resolution_notes:
      typeof resolutionNotesRaw === "string" ? resolutionNotesRaw : resolutionNotesRaw === null ? null : null,
    photos,
    created_at,
  }
}

async function getFindingByIdForUser(id: number, userId: number): Promise<FindingRow | null> {
  const support = await getFindingsSchemaSupport()
  const hasExtras = support.responsible_worker_id && support.plan_zone_id && support.related_document_type_ids
  const canJoinZones = hasExtras && support.plan_zones_table
  const canJoinFloors = canJoinZones && support.plan_floors_table

  let rows: Record<string, unknown>[] = []
  if (hasExtras) {
    if (canJoinZones) {
      rows = canJoinFloors
        ? await sql<Record<string, unknown>>`
            SELECT
              f.id,
              f.title,
              f.description,
              f.location,
              f.responsible_person,
              f.responsible_worker_id,
              CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
              f.severity,
              f.status,
              p.name as project_name,
              f.plan_zone_id,
              z.name as plan_zone_name,
              pf.name as plan_floor_name,
              f.related_document_type_ids,
              f.due_date::text as due_date,
              f.resolution_notes,
              f.photos,
              f.created_at::text as created_at
            FROM findings f
            LEFT JOIN projects p ON f.project_id = p.id
            LEFT JOIN workers w ON f.responsible_worker_id = w.id
            LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
            LEFT JOIN plan_floors pf ON z.floor_id = pf.id
            WHERE f.id = ${id}
              AND (
                f.user_id = ${userId}
                OR (f.user_id IS NULL AND p.user_id = ${userId})
              )
            LIMIT 1
          `
        : await sql<Record<string, unknown>>`
            SELECT
              f.id,
              f.title,
              f.description,
              f.location,
              f.responsible_person,
              f.responsible_worker_id,
              CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
              f.severity,
              f.status,
              p.name as project_name,
              f.plan_zone_id,
              z.name as plan_zone_name,
              NULL::text as plan_floor_name,
              f.related_document_type_ids,
              f.due_date::text as due_date,
              f.resolution_notes,
              f.photos,
              f.created_at::text as created_at
            FROM findings f
            LEFT JOIN projects p ON f.project_id = p.id
            LEFT JOIN workers w ON f.responsible_worker_id = w.id
            LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
            WHERE f.id = ${id}
              AND (
                f.user_id = ${userId}
                OR (f.user_id IS NULL AND p.user_id = ${userId})
              )
            LIMIT 1
          `
    } else {
      rows = await sql<Record<string, unknown>>`
        SELECT
          f.id,
          f.title,
          f.description,
          f.location,
          f.responsible_person,
          f.responsible_worker_id,
          CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
          f.severity,
          f.status,
          p.name as project_name,
          f.plan_zone_id,
          NULL::text as plan_zone_name,
          NULL::text as plan_floor_name,
          f.related_document_type_ids,
          f.due_date::text as due_date,
          f.resolution_notes,
          f.photos,
          f.created_at::text as created_at
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        LEFT JOIN workers w ON f.responsible_worker_id = w.id
        WHERE f.id = ${id}
          AND (
            f.user_id = ${userId}
            OR (f.user_id IS NULL AND p.user_id = ${userId})
          )
        LIMIT 1
      `
    }
  } else {
    rows = await sql<Record<string, unknown>>`
      SELECT
        f.id,
        f.title,
        f.description,
        f.location,
        f.responsible_person,
        NULL::int as responsible_worker_id,
        NULL::text as responsible_worker_name,
        f.severity,
        f.status,
        p.name as project_name,
        NULL::int as plan_zone_id,
        NULL::text as plan_zone_name,
        NULL::text as plan_floor_name,
        '[]'::jsonb as related_document_type_ids,
        f.due_date::text as due_date,
        f.resolution_notes,
        f.photos,
        f.created_at::text as created_at
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.id = ${id}
        AND (
          f.user_id = ${userId}
          OR (f.user_id IS NULL AND p.user_id = ${userId})
        )
      LIMIT 1
    `
  }
  const row = rows[0]
  if (!row) return null
  return serializeFindingRow(row)
}

function extFromMime(m: string) {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
  }
  return map[m] || "png"
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

export async function getFindings(projectId?: number, status?: string) {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const support = await getFindingsSchemaSupport()
  const hasExtras = support.responsible_worker_id && support.plan_zone_id && support.related_document_type_ids
  const canJoinZones = hasExtras && support.plan_zones_table
  const canJoinFloors = canJoinZones && support.plan_floors_table
  if (projectId && status) {
    let rows: Record<string, unknown>[] = []
    if (hasExtras) {
      if (canJoinZones) {
        rows = canJoinFloors
          ? await sql<Record<string, unknown>>`
              SELECT
                f.id,
                f.title,
                f.description,
                f.location,
                f.responsible_person,
                f.responsible_worker_id,
                CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
                f.severity,
                f.status,
                p.name as project_name,
                f.plan_zone_id,
                z.name as plan_zone_name,
                pf.name as plan_floor_name,
                f.related_document_type_ids,
                f.due_date::text as due_date,
                f.resolution_notes,
                f.photos,
                f.created_at::text as created_at
              FROM findings f
              LEFT JOIN projects p ON f.project_id = p.id
              LEFT JOIN workers w ON f.responsible_worker_id = w.id
              LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
              LEFT JOIN plan_floors pf ON z.floor_id = pf.id
              WHERE f.project_id = ${projectId}
                AND f.status = ${status}
                AND (
                  f.user_id = ${userId}
                  OR (f.user_id IS NULL AND p.user_id = ${userId})
                )
              ORDER BY 
                CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                f.created_at DESC
            `
          : await sql<Record<string, unknown>>`
              SELECT
                f.id,
                f.title,
                f.description,
                f.location,
                f.responsible_person,
                f.responsible_worker_id,
                CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
                f.severity,
                f.status,
                p.name as project_name,
                f.plan_zone_id,
                z.name as plan_zone_name,
                NULL::text as plan_floor_name,
                f.related_document_type_ids,
                f.due_date::text as due_date,
                f.resolution_notes,
                f.photos,
                f.created_at::text as created_at
              FROM findings f
              LEFT JOIN projects p ON f.project_id = p.id
              LEFT JOIN workers w ON f.responsible_worker_id = w.id
              LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
              WHERE f.project_id = ${projectId}
                AND f.status = ${status}
                AND (
                  f.user_id = ${userId}
                  OR (f.user_id IS NULL AND p.user_id = ${userId})
                )
              ORDER BY 
                CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                f.created_at DESC
            `
      } else {
        rows = await sql<Record<string, unknown>>`
          SELECT
            f.id,
            f.title,
            f.description,
            f.location,
            f.responsible_person,
            f.responsible_worker_id,
            CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
            f.severity,
            f.status,
            p.name as project_name,
            f.plan_zone_id,
            NULL::text as plan_zone_name,
            NULL::text as plan_floor_name,
            f.related_document_type_ids,
            f.due_date::text as due_date,
            f.resolution_notes,
            f.photos,
            f.created_at::text as created_at
          FROM findings f
          LEFT JOIN projects p ON f.project_id = p.id
          LEFT JOIN workers w ON f.responsible_worker_id = w.id
          WHERE f.project_id = ${projectId}
            AND f.status = ${status}
            AND (
              f.user_id = ${userId}
              OR (f.user_id IS NULL AND p.user_id = ${userId})
            )
          ORDER BY 
            CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
            f.created_at DESC
        `
      }
    } else {
      rows = await sql<Record<string, unknown>>`
        SELECT
          f.id,
          f.title,
          f.description,
          f.location,
          f.responsible_person,
          NULL::int as responsible_worker_id,
          NULL::text as responsible_worker_name,
          f.severity,
          f.status,
          p.name as project_name,
          NULL::int as plan_zone_id,
          NULL::text as plan_zone_name,
          NULL::text as plan_floor_name,
          '[]'::jsonb as related_document_type_ids,
          f.due_date::text as due_date,
          f.resolution_notes,
          f.photos,
          f.created_at::text as created_at
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE f.project_id = ${projectId}
          AND f.status = ${status}
          AND (
            f.user_id = ${userId}
            OR (f.user_id IS NULL AND p.user_id = ${userId})
          )
        ORDER BY 
          CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          f.created_at DESC
      `
    }
    return (rows || []).map(serializeFindingRow)
  }

  if (projectId) {
    let rows: Record<string, unknown>[] = []
    if (hasExtras) {
      if (canJoinZones) {
        rows = canJoinFloors
          ? await sql<Record<string, unknown>>`
              SELECT
                f.id,
                f.title,
                f.description,
                f.location,
                f.responsible_person,
                f.responsible_worker_id,
                CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
                f.severity,
                f.status,
                p.name as project_name,
                f.plan_zone_id,
                z.name as plan_zone_name,
                pf.name as plan_floor_name,
                f.related_document_type_ids,
                f.due_date::text as due_date,
                f.resolution_notes,
                f.photos,
                f.created_at::text as created_at
              FROM findings f
              LEFT JOIN projects p ON f.project_id = p.id
              LEFT JOIN workers w ON f.responsible_worker_id = w.id
              LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
              LEFT JOIN plan_floors pf ON z.floor_id = pf.id
              WHERE f.project_id = ${projectId}
                AND (
                  f.user_id = ${userId}
                  OR (f.user_id IS NULL AND p.user_id = ${userId})
                )
              ORDER BY 
                CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                f.created_at DESC
            `
          : await sql<Record<string, unknown>>`
              SELECT
                f.id,
                f.title,
                f.description,
                f.location,
                f.responsible_person,
                f.responsible_worker_id,
                CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
                f.severity,
                f.status,
                p.name as project_name,
                f.plan_zone_id,
                z.name as plan_zone_name,
                NULL::text as plan_floor_name,
                f.related_document_type_ids,
                f.due_date::text as due_date,
                f.resolution_notes,
                f.photos,
                f.created_at::text as created_at
              FROM findings f
              LEFT JOIN projects p ON f.project_id = p.id
              LEFT JOIN workers w ON f.responsible_worker_id = w.id
              LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
              WHERE f.project_id = ${projectId}
                AND (
                  f.user_id = ${userId}
                  OR (f.user_id IS NULL AND p.user_id = ${userId})
                )
              ORDER BY 
                CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                f.created_at DESC
            `
      } else {
        rows = await sql<Record<string, unknown>>`
          SELECT
            f.id,
            f.title,
            f.description,
            f.location,
            f.responsible_person,
            f.responsible_worker_id,
            CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
            f.severity,
            f.status,
            p.name as project_name,
            f.plan_zone_id,
            NULL::text as plan_zone_name,
            NULL::text as plan_floor_name,
            f.related_document_type_ids,
            f.due_date::text as due_date,
            f.resolution_notes,
            f.photos,
            f.created_at::text as created_at
          FROM findings f
          LEFT JOIN projects p ON f.project_id = p.id
          LEFT JOIN workers w ON f.responsible_worker_id = w.id
          WHERE f.project_id = ${projectId}
            AND (
              f.user_id = ${userId}
              OR (f.user_id IS NULL AND p.user_id = ${userId})
            )
          ORDER BY 
            CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
            f.created_at DESC
        `
      }
    } else {
      rows = await sql<Record<string, unknown>>`
        SELECT
          f.id,
          f.title,
          f.description,
          f.location,
          f.responsible_person,
          NULL::int as responsible_worker_id,
          NULL::text as responsible_worker_name,
          f.severity,
          f.status,
          p.name as project_name,
          NULL::int as plan_zone_id,
          NULL::text as plan_zone_name,
          NULL::text as plan_floor_name,
          '[]'::jsonb as related_document_type_ids,
          f.due_date::text as due_date,
          f.resolution_notes,
          f.photos,
          f.created_at::text as created_at
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE f.project_id = ${projectId}
          AND (
            f.user_id = ${userId}
            OR (f.user_id IS NULL AND p.user_id = ${userId})
          )
        ORDER BY 
          CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          f.created_at DESC
      `
    }
    return (rows || []).map(serializeFindingRow)
  }

  if (status) {
    let rows: Record<string, unknown>[] = []
    if (hasExtras) {
      if (canJoinZones) {
        rows = canJoinFloors
          ? await sql<Record<string, unknown>>`
              SELECT
                f.id,
                f.title,
                f.description,
                f.location,
                f.responsible_person,
                f.responsible_worker_id,
                CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
                f.severity,
                f.status,
                p.name as project_name,
                f.plan_zone_id,
                z.name as plan_zone_name,
                pf.name as plan_floor_name,
                f.related_document_type_ids,
                f.due_date::text as due_date,
                f.resolution_notes,
                f.photos,
                f.created_at::text as created_at
              FROM findings f
              LEFT JOIN projects p ON f.project_id = p.id
              LEFT JOIN workers w ON f.responsible_worker_id = w.id
              LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
              LEFT JOIN plan_floors pf ON z.floor_id = pf.id
              WHERE f.status = ${status}
                AND (
                  f.user_id = ${userId}
                  OR (f.user_id IS NULL AND p.user_id = ${userId})
                )
              ORDER BY 
                CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                f.created_at DESC
            `
          : await sql<Record<string, unknown>>`
              SELECT
                f.id,
                f.title,
                f.description,
                f.location,
                f.responsible_person,
                f.responsible_worker_id,
                CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
                f.severity,
                f.status,
                p.name as project_name,
                f.plan_zone_id,
                z.name as plan_zone_name,
                NULL::text as plan_floor_name,
                f.related_document_type_ids,
                f.due_date::text as due_date,
                f.resolution_notes,
                f.photos,
                f.created_at::text as created_at
              FROM findings f
              LEFT JOIN projects p ON f.project_id = p.id
              LEFT JOIN workers w ON f.responsible_worker_id = w.id
              LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
              WHERE f.status = ${status}
                AND (
                  f.user_id = ${userId}
                  OR (f.user_id IS NULL AND p.user_id = ${userId})
                )
              ORDER BY 
                CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
                f.created_at DESC
            `
      } else {
        rows = await sql<Record<string, unknown>>`
          SELECT
            f.id,
            f.title,
            f.description,
            f.location,
            f.responsible_person,
            f.responsible_worker_id,
            CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
            f.severity,
            f.status,
            p.name as project_name,
            f.plan_zone_id,
            NULL::text as plan_zone_name,
            NULL::text as plan_floor_name,
            f.related_document_type_ids,
            f.due_date::text as due_date,
            f.resolution_notes,
            f.photos,
            f.created_at::text as created_at
          FROM findings f
          LEFT JOIN projects p ON f.project_id = p.id
          LEFT JOIN workers w ON f.responsible_worker_id = w.id
          WHERE f.status = ${status}
            AND (
              f.user_id = ${userId}
              OR (f.user_id IS NULL AND p.user_id = ${userId})
            )
          ORDER BY 
            CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
            f.created_at DESC
        `
      }
    } else {
      rows = await sql<Record<string, unknown>>`
        SELECT
          f.id,
          f.title,
          f.description,
          f.location,
          f.responsible_person,
          NULL::int as responsible_worker_id,
          NULL::text as responsible_worker_name,
          f.severity,
          f.status,
          p.name as project_name,
          NULL::int as plan_zone_id,
          NULL::text as plan_zone_name,
          NULL::text as plan_floor_name,
          '[]'::jsonb as related_document_type_ids,
          f.due_date::text as due_date,
          f.resolution_notes,
          f.photos,
          f.created_at::text as created_at
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE f.status = ${status}
          AND (
            f.user_id = ${userId}
            OR (f.user_id IS NULL AND p.user_id = ${userId})
          )
        ORDER BY 
          CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          f.created_at DESC
      `
    }
    return (rows || []).map(serializeFindingRow)
  }

  let rows: Record<string, unknown>[] = []
  if (hasExtras) {
    if (canJoinZones) {
      rows = canJoinFloors
        ? await sql<Record<string, unknown>>`
            SELECT
              f.id,
              f.title,
              f.description,
              f.location,
              f.responsible_person,
              f.responsible_worker_id,
              CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
              f.severity,
              f.status,
              p.name as project_name,
              f.plan_zone_id,
              z.name as plan_zone_name,
              pf.name as plan_floor_name,
              f.related_document_type_ids,
              f.due_date::text as due_date,
              f.resolution_notes,
              f.photos,
              f.created_at::text as created_at
            FROM findings f
            LEFT JOIN projects p ON f.project_id = p.id
            LEFT JOIN workers w ON f.responsible_worker_id = w.id
            LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
            LEFT JOIN plan_floors pf ON z.floor_id = pf.id
            WHERE (
              f.user_id = ${userId}
              OR (f.user_id IS NULL AND p.user_id = ${userId})
            )
            ORDER BY 
              CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
              f.created_at DESC
          `
        : await sql<Record<string, unknown>>`
            SELECT
              f.id,
              f.title,
              f.description,
              f.location,
              f.responsible_person,
              f.responsible_worker_id,
              CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
              f.severity,
              f.status,
              p.name as project_name,
              f.plan_zone_id,
              z.name as plan_zone_name,
              NULL::text as plan_floor_name,
              f.related_document_type_ids,
              f.due_date::text as due_date,
              f.resolution_notes,
              f.photos,
              f.created_at::text as created_at
            FROM findings f
            LEFT JOIN projects p ON f.project_id = p.id
            LEFT JOIN workers w ON f.responsible_worker_id = w.id
            LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
            WHERE (
              f.user_id = ${userId}
              OR (f.user_id IS NULL AND p.user_id = ${userId})
            )
            ORDER BY 
              CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
              f.created_at DESC
          `
    } else {
      rows = await sql<Record<string, unknown>>`
        SELECT
          f.id,
          f.title,
          f.description,
          f.location,
          f.responsible_person,
          f.responsible_worker_id,
          CASE WHEN w.id IS NULL THEN NULL ELSE (w.first_name || ' ' || w.last_name) END as responsible_worker_name,
          f.severity,
          f.status,
          p.name as project_name,
          f.plan_zone_id,
          NULL::text as plan_zone_name,
          NULL::text as plan_floor_name,
          f.related_document_type_ids,
          f.due_date::text as due_date,
          f.resolution_notes,
          f.photos,
          f.created_at::text as created_at
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        LEFT JOIN workers w ON f.responsible_worker_id = w.id
        WHERE (
          f.user_id = ${userId}
          OR (f.user_id IS NULL AND p.user_id = ${userId})
        )
        ORDER BY 
          CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          f.created_at DESC
      `
    }
  } else {
    rows = await sql<Record<string, unknown>>`
      SELECT
        f.id,
        f.title,
        f.description,
        f.location,
        f.responsible_person,
        NULL::int as responsible_worker_id,
        NULL::text as responsible_worker_name,
        f.severity,
        f.status,
        p.name as project_name,
        NULL::int as plan_zone_id,
        NULL::text as plan_zone_name,
        NULL::text as plan_floor_name,
        '[]'::jsonb as related_document_type_ids,
        f.due_date::text as due_date,
        f.resolution_notes,
        f.photos,
        f.created_at::text as created_at
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE (
        f.user_id = ${userId}
        OR (f.user_id IS NULL AND p.user_id = ${userId})
      )
      ORDER BY 
        CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        f.created_at DESC
    `
  }
  return (rows || []).map(serializeFindingRow)
}

export async function createFinding(data: {
  project_id?: number
  checklist_id?: number
  title: string
  description?: string
  severity: "low" | "medium" | "high" | "critical"
  location?: string
  responsible_person?: string
  responsible_worker_id?: number
  plan_zone_id?: number
  related_document_type_ids?: number[]
  due_date?: string
  photos?: string[]
}) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para crear hallazgos")
  }
  const support = await getFindingsSchemaSupport()
  const hasExtras = support.responsible_worker_id && support.plan_zone_id && support.related_document_type_ids

  const result = hasExtras
    ? await sql<{ id: number }>`
        INSERT INTO findings (user_id, project_id, checklist_id, title, description, severity, location, responsible_person, responsible_worker_id, plan_zone_id, related_document_type_ids, due_date, photos)
        VALUES (${userId}, ${data.project_id || null}, ${data.checklist_id || null}, ${data.title}, ${data.description || null},
                ${data.severity}, ${data.location || null}, ${data.responsible_person || null},
                ${data.responsible_worker_id || null}, ${data.plan_zone_id || null},
                ${JSON.stringify((data.related_document_type_ids || []).map((n) => Number(n)).filter((n) => Number.isFinite(n)))}::jsonb,
                ${data.due_date || null}, NULL)
        RETURNING id
      `
    : await sql<{ id: number }>`
        INSERT INTO findings (user_id, project_id, checklist_id, title, description, severity, location, responsible_person, due_date, photos)
        VALUES (${userId}, ${data.project_id || null}, ${data.checklist_id || null}, ${data.title}, ${data.description || null},
                ${data.severity}, ${data.location || null}, ${data.responsible_person || null},
                ${data.due_date || null}, NULL)
        RETURNING id
      `
  const findingId = Number(result[0].id)
  if (Array.isArray(data.photos) && data.photos.length > 0) {
    const out: string[] = []
    for (let i = 0; i < data.photos.length; i++) {
      const p = data.photos[i]
      if (typeof p === "string" && p.startsWith("data:")) {
        const m = p.match(/^data:([^;]+);base64,(.+)$/)
        const mime = m ? m[1] : "image/png"
        const ext = extFromMime(mime)
        const path = `findings/${userId}/${findingId}-${i}.${ext}`
        const uploaded = await uploadBase64ToSupabase("img", path, p)
        if (uploaded) out.push(uploaded)
        else out.push(p)
      } else if (typeof p === "string") {
        out.push(p)
      }
    }
    await sql`UPDATE findings SET photos = ${JSON.stringify(out)}::jsonb WHERE id = ${findingId}`
  }
  revalidatePath("/hallazgos")
  if (data.project_id) {
    revalidatePath(`/proyectos/${data.project_id}/hallazgos`)
  }
  revalidatePath("/")
  const row = await getFindingByIdForUser(findingId, userId)
  if (!row) throw new Error("No se pudo cargar el hallazgo creado")
  return row
}

export async function getFindingsTimeline(
  mode: FindingTimelineMode,
  projectId?: number,
): Promise<FindingTimelineRow[]> {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const projectParam = projectId ?? null

  if (mode === "day") {
    const createdRows = await sql<{ bucket: string | Date; count: number }>`
      SELECT date_trunc('day', f.created_at)::date as bucket, COUNT(*)::int as count
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE
        (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
        AND (
          f.user_id = ${userId}
          OR (f.user_id IS NULL AND p.user_id = ${userId})
        )
        AND f.created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY date_trunc('day', f.created_at)
      ORDER BY bucket
    `
    const resolvedRows = await sql<{ bucket: string | Date; count: number }>`
      SELECT date_trunc('day', f.resolved_at)::date as bucket, COUNT(*)::int as count
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE
        (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
        AND (
          f.user_id = ${userId}
          OR (f.user_id IS NULL AND p.user_id = ${userId})
        )
        AND f.resolved_at IS NOT NULL
        AND f.resolved_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY date_trunc('day', f.resolved_at)
      ORDER BY bucket
    `
    const map = new Map<
      string,
      {
        created_count: number
        resolved_count: number
      }
    >()
    for (const r of createdRows || []) {
      const key = normalizeBucket(r.bucket)
      const prev = map.get(key) || { created_count: 0, resolved_count: 0 }
      prev.created_count += Number(r.count || 0)
      map.set(key, prev)
    }
    for (const r of resolvedRows || []) {
      const key = normalizeBucket(r.bucket)
      const prev = map.get(key) || { created_count: 0, resolved_count: 0 }
      prev.resolved_count += Number(r.count || 0)
      map.set(key, prev)
    }
    const entries = Array.from(map.entries())
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return entries.map(([bucket, v]) => ({
      bucket,
      created_count: v.created_count,
      resolved_count: v.resolved_count,
    }))
  }

  if (mode === "week") {
    const createdRows = await sql<{ bucket: string | Date; count: number }>`
      SELECT date_trunc('week', f.created_at)::date as bucket, COUNT(*)::int as count
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE
        (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
        AND (
          f.user_id = ${userId}
          OR (f.user_id IS NULL AND p.user_id = ${userId})
        )
        AND f.created_at >= CURRENT_DATE - INTERVAL '12 weeks'
      GROUP BY date_trunc('week', f.created_at)
      ORDER BY bucket
    `
    const resolvedRows = await sql<{ bucket: string | Date; count: number }>`
      SELECT date_trunc('week', f.resolved_at)::date as bucket, COUNT(*)::int as count
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE
        (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
        AND (
          f.user_id = ${userId}
          OR (f.user_id IS NULL AND p.user_id = ${userId})
        )
        AND f.resolved_at IS NOT NULL
        AND f.resolved_at >= CURRENT_DATE - INTERVAL '12 weeks'
      GROUP BY date_trunc('week', f.resolved_at)
      ORDER BY bucket
    `
    const map = new Map<
      string,
      {
        created_count: number
        resolved_count: number
      }
    >()
    for (const r of createdRows || []) {
      const key = normalizeBucket(r.bucket)
      const prev = map.get(key) || { created_count: 0, resolved_count: 0 }
      prev.created_count += Number(r.count || 0)
      map.set(key, prev)
    }
    for (const r of resolvedRows || []) {
      const key = normalizeBucket(r.bucket)
      const prev = map.get(key) || { created_count: 0, resolved_count: 0 }
      prev.resolved_count += Number(r.count || 0)
      map.set(key, prev)
    }
    const entries = Array.from(map.entries())
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return entries.map(([bucket, v]) => ({
      bucket,
      created_count: v.created_count,
      resolved_count: v.resolved_count,
    }))
  }

  const createdRows = await sql<{ bucket: string | Date; count: number }>`
    SELECT date_trunc('month', f.created_at)::date as bucket, COUNT(*)::int as count
    FROM findings f
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE
      (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
      AND (
        f.user_id = ${userId}
        OR (f.user_id IS NULL AND p.user_id = ${userId})
      )
      AND f.created_at >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY date_trunc('month', f.created_at)
    ORDER BY bucket
  `
  const resolvedRows = await sql<{ bucket: string | Date; count: number }>`
    SELECT date_trunc('month', f.resolved_at)::date as bucket, COUNT(*)::int as count
    FROM findings f
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE
      (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
      AND (
        f.user_id = ${userId}
        OR (f.user_id IS NULL AND p.user_id = ${userId})
      )
      AND f.resolved_at IS NOT NULL
      AND f.resolved_at >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY date_trunc('month', f.resolved_at)
    ORDER BY bucket
  `
  const map = new Map<
    string,
    {
      created_count: number
      resolved_count: number
    }
  >()
  for (const r of createdRows || []) {
    const key = normalizeBucket(r.bucket)
    const prev = map.get(key) || { created_count: 0, resolved_count: 0 }
    prev.created_count += Number(r.count || 0)
    map.set(key, prev)
  }
  for (const r of resolvedRows || []) {
    const key = normalizeBucket(r.bucket)
    const prev = map.get(key) || { created_count: 0, resolved_count: 0 }
    prev.resolved_count += Number(r.count || 0)
    map.set(key, prev)
  }
  const entries = Array.from(map.entries())
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return entries.map(([bucket, v]) => ({
    bucket,
    created_count: v.created_count,
    resolved_count: v.resolved_count,
  }))
}

export async function getFindingAnalytics(projectId?: number): Promise<FindingAnalytics> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      total: 0,
      open: 0,
      in_progress: 0,
      resolved: 0,
      overdue: 0,
      avg_resolution_days: null,
      avg_open_days: null,
      top_zones: [],
      oldest_open: null,
    }
  }
  const projectParam = projectId ?? null
  const support = await getFindingsSchemaSupport()
  const hasZone = support.plan_zone_id && support.plan_zones_table
  const hasFloor = hasZone && support.plan_floors_table

  const countRows = await sql<{
    total: number
    open: number
    in_progress: number
    resolved: number
    overdue: number
  }>`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE f.status = 'open')::int as open,
      COUNT(*) FILTER (WHERE f.status = 'in_progress')::int as in_progress,
      COUNT(*) FILTER (WHERE f.status = 'resolved' OR f.status = 'closed')::int as resolved,
      COUNT(*) FILTER (
        WHERE
          (f.status = 'open' OR f.status = 'in_progress')
          AND f.due_date IS NOT NULL
          AND f.due_date < CURRENT_DATE
      )::int as overdue
    FROM findings f
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE
      (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
      AND (
        f.user_id = ${userId}
        OR (f.user_id IS NULL AND p.user_id = ${userId})
      )
  `
  const counts = countRows[0] || {
    total: 0,
    open: 0,
    in_progress: 0,
    resolved: 0,
    overdue: 0,
  }

  const avgResolutionRows = await sql<{ avg_days: number | null }>`
    SELECT AVG(EXTRACT(EPOCH FROM (f.resolved_at - f.created_at)) / 86400.0) as avg_days
    FROM findings f
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE
      f.resolved_at IS NOT NULL
      AND (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
      AND (
        f.user_id = ${userId}
        OR (f.user_id IS NULL AND p.user_id = ${userId})
      )
  `
  const avgOpenRows = await sql<{ avg_days: number | null }>`
    SELECT AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - f.created_at)) / 86400.0) as avg_days
    FROM findings f
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE
      (f.status = 'open' OR f.status = 'in_progress')
      AND (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
      AND (
        f.user_id = ${userId}
        OR (f.user_id IS NULL AND p.user_id = ${userId})
      )
  `
  const avg_resolution_days =
    avgResolutionRows[0] && avgResolutionRows[0].avg_days !== null && avgResolutionRows[0].avg_days !== undefined
      ? Number(avgResolutionRows[0].avg_days)
      : null
  const avg_open_days =
    avgOpenRows[0] && avgOpenRows[0].avg_days !== null && avgOpenRows[0].avg_days !== undefined
      ? Number(avgOpenRows[0].avg_days)
      : null

  let topZones: FindingAnalytics["top_zones"] = []
  if (hasZone) {
    if (hasFloor) {
      const rows = await sql<{
        plan_zone_id: number | null
        plan_zone_name: string | null
        plan_floor_name: string | null
        total: number
        open: number
      }>`
        SELECT
          z.id as plan_zone_id,
          z.name as plan_zone_name,
          pf.name as plan_floor_name,
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE f.status = 'open' OR f.status = 'in_progress')::int as open
        FROM findings f
        JOIN plan_zones z ON f.plan_zone_id = z.id
        LEFT JOIN plan_floors pf ON z.floor_id = pf.id
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE
          (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
          AND (
            f.user_id = ${userId}
            OR (f.user_id IS NULL AND p.user_id = ${userId})
          )
        GROUP BY z.id, z.name, pf.name
        ORDER BY total DESC
        LIMIT 5
      `
      topZones = (rows || []).map((r) => ({
        label: r.plan_zone_name || "Zona sin nombre",
        floor: r.plan_floor_name || null,
        total: Number(r.total || 0),
        open: Number(r.open || 0),
      }))
    } else {
      const rows = await sql<{
        plan_zone_id: number | null
        plan_zone_name: string | null
        total: number
        open: number
      }>`
        SELECT
          z.id as plan_zone_id,
          z.name as plan_zone_name,
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE f.status = 'open' OR f.status = 'in_progress')::int as open
        FROM findings f
        JOIN plan_zones z ON f.plan_zone_id = z.id
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE
          (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
          AND (
            f.user_id = ${userId}
            OR (f.user_id IS NULL AND p.user_id = ${userId})
          )
        GROUP BY z.id, z.name
        ORDER BY total DESC
        LIMIT 5
      `
      topZones = (rows || []).map((r) => ({
        label: r.plan_zone_name || "Zona sin nombre",
        floor: null,
        total: Number(r.total || 0),
        open: Number(r.open || 0),
      }))
    }
  } else {
    const rows = await sql<{
      label: string | null
      total: number
      open: number
    }>`
      SELECT
        COALESCE(f.location, 'Sin ubicación') as label,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE f.status = 'open' OR f.status = 'in_progress')::int as open
      FROM findings f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE
        (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
        AND (
          f.user_id = ${userId}
          OR (f.user_id IS NULL AND p.user_id = ${userId})
        )
      GROUP BY COALESCE(f.location, 'Sin ubicación')
      ORDER BY total DESC
      LIMIT 5
    `
    topZones = (rows || []).map((r) => ({
      label: r.label || "Sin ubicación",
      floor: null,
      total: Number(r.total || 0),
      open: Number(r.open || 0),
    }))
  }

  let oldestOpen: FindingAnalytics["oldest_open"] = null
  if (counts.open + counts.in_progress > 0) {
    if (hasZone) {
      const rows = await sql<{
        id: number
        title: string
        severity: string
        location: string | null
        project_name: string | null
        plan_zone_name: string | null
        created_at: Date
      }>`
        SELECT
          f.id,
          f.title,
          f.severity,
          f.location,
          p.name as project_name,
          z.name as plan_zone_name,
          f.created_at
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        LEFT JOIN plan_zones z ON f.plan_zone_id = z.id
        WHERE
          (f.status = 'open' OR f.status = 'in_progress')
          AND (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
          AND (
            f.user_id = ${userId}
            OR (f.user_id IS NULL AND p.user_id = ${userId})
          )
        ORDER BY f.created_at ASC
        LIMIT 1
      `
      const row = rows[0]
      if (row) {
        const created =
          row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))
        const now = new Date()
        const days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
        oldestOpen = {
          id: Number(row.id),
          title: String(row.title),
          severity: String(row.severity),
          location: row.location ?? null,
          project_name: row.project_name ?? null,
          plan_zone_name: row.plan_zone_name ?? null,
          created_at: created.toISOString(),
          days_open: days,
        }
      }
    } else {
      const rows = await sql<{
        id: number
        title: string
        severity: string
        location: string | null
        project_name: string | null
        created_at: Date
      }>`
        SELECT
          f.id,
          f.title,
          f.severity,
          f.location,
          p.name as project_name,
          f.created_at
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE
          (f.status = 'open' OR f.status = 'in_progress')
          AND (${projectParam}::int IS NULL OR f.project_id = ${projectParam}::int)
          AND (
            f.user_id = ${userId}
            OR (f.user_id IS NULL AND p.user_id = ${userId})
          )
        ORDER BY f.created_at ASC
        LIMIT 1
      `
      const row = rows[0]
      if (row) {
        const created =
          row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))
        const now = new Date()
        const days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
        oldestOpen = {
          id: Number(row.id),
          title: String(row.title),
          severity: String(row.severity),
          location: row.location ?? null,
          project_name: row.project_name ?? null,
          plan_zone_name: null,
          created_at: created.toISOString(),
          days_open: days,
        }
      }
    }
  }

  return {
    total: Number(counts.total || 0),
    open: Number(counts.open || 0),
    in_progress: Number(counts.in_progress || 0),
    resolved: Number(counts.resolved || 0),
    overdue: Number(counts.overdue || 0),
    avg_resolution_days,
    avg_open_days,
    top_zones: topZones,
    oldest_open: oldestOpen,
  }
}

export async function updateFinding(
  id: number,
  data: Partial<{
    title: string
    description: string
    severity: "low" | "medium" | "high" | "critical"
    location: string
    responsible_person: string
    responsible_worker_id: number | null
    plan_zone_id: number | null
    related_document_type_ids: number[]
    due_date: string
    status: "open" | "in_progress" | "resolved" | "closed"
    resolution_notes: string
  }>,
) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para actualizar hallazgos")
  }
  const support = await getFindingsSchemaSupport()
  const hasExtras = support.responsible_worker_id && support.plan_zone_id && support.related_document_type_ids

  const rows = hasExtras
    ? await sql<Record<string, unknown>>`
        UPDATE findings f
        SET 
          title = COALESCE(${data.title || null}, title),
          description = COALESCE(${data.description || null}, description),
          severity = COALESCE(${data.severity || null}, severity),
          location = COALESCE(${data.location || null}, location),
          responsible_person = COALESCE(${data.responsible_person || null}, responsible_person),
          responsible_worker_id = COALESCE(${data.responsible_worker_id ?? null}, responsible_worker_id),
          plan_zone_id = COALESCE(${data.plan_zone_id ?? null}, plan_zone_id),
          related_document_type_ids = COALESCE(${data.related_document_type_ids ? JSON.stringify(data.related_document_type_ids) : null}::jsonb, related_document_type_ids),
          due_date = COALESCE(${data.due_date || null}, due_date),
          status = COALESCE(${data.status || null}, status),
          resolution_notes = COALESCE(${data.resolution_notes || null}, resolution_notes),
          resolved_at = CASE WHEN ${data.status || null} = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
          updated_at = CURRENT_TIMESTAMP,
          user_id = COALESCE(user_id, ${userId})
        WHERE f.id = ${id}
          AND (
            f.user_id = ${userId}
            OR (
              f.user_id IS NULL
              AND EXISTS (SELECT 1 FROM projects p WHERE p.id = f.project_id AND p.user_id = ${userId})
            )
          )
        RETURNING f.id
      `
    : await sql<Record<string, unknown>>`
        UPDATE findings f
        SET 
          title = COALESCE(${data.title || null}, title),
          description = COALESCE(${data.description || null}, description),
          severity = COALESCE(${data.severity || null}, severity),
          location = COALESCE(${data.location || null}, location),
          responsible_person = COALESCE(${data.responsible_person || null}, responsible_person),
          due_date = COALESCE(${data.due_date || null}, due_date),
          status = COALESCE(${data.status || null}, status),
          resolution_notes = COALESCE(${data.resolution_notes || null}, resolution_notes),
          resolved_at = CASE WHEN ${data.status || null} = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END,
          updated_at = CURRENT_TIMESTAMP,
          user_id = COALESCE(user_id, ${userId})
        WHERE f.id = ${id}
          AND (
            f.user_id = ${userId}
            OR (
              f.user_id IS NULL
              AND EXISTS (SELECT 1 FROM projects p WHERE p.id = f.project_id AND p.user_id = ${userId})
            )
          )
        RETURNING f.id
      `
  const updatedId = typeof rows[0]?.id === "number" ? rows[0]?.id : Number(rows[0]?.id)
  revalidatePath("/hallazgos")
  revalidatePath("/")
  const row = await getFindingByIdForUser(updatedId, userId)
  if (!row) throw new Error("No se pudo cargar el hallazgo actualizado")
  return row
}

export async function deleteFinding(id: number) {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error("Debes iniciar sesión para eliminar hallazgos")
  }
  await sql`
    DELETE FROM findings f
    WHERE f.id = ${id}
      AND (
        f.user_id = ${userId}
        OR (
          f.user_id IS NULL
          AND EXISTS (SELECT 1 FROM projects p WHERE p.id = f.project_id AND p.user_id = ${userId})
        )
      )
  `
  revalidatePath("/hallazgos")
}

export async function scanFindingImage(base64Image: string, mimeType: string): Promise<{
  title?: string
  description?: string
  severity?: "low" | "medium" | "high" | "critical"
  location?: string
  responsible_person?: string
  due_date?: string
}> {
  const apiKey =
    (await getSetting("ai_api_key")) || process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || ""
  if (!apiKey) {
    return {}
  }
  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const prompt =
    `Analiza la imagen y devuelve un JSON con: title, description, severity (low|medium|high|critical), location, responsible_person, due_date (YYYY-MM-DD). Si algun dato no se puede inferir usa null. Responde solo el JSON.`
  const { text } = await generateText({
    model: getModel(provider, model, apiKey) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: `data:${mimeType};base64,${base64Image}` },
        ],
      },
    ],
  })
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim()
  try {
    const parsed = JSON.parse(cleaned)
    return parsed
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
  }
  return {}
}

export async function generateCorrectiveAction(args: {
  title?: string
  description?: string
  severity?: "low" | "medium" | "high" | "critical"
  location?: string
  photos?: string[]
}): Promise<string> {
  const apiKey =
    (await getSetting("ai_api_key")) || process.env.AI_API_KEY || process.env.GOOGLE_API_KEY || ""
  if (!apiKey) {
    const lines = [
      "- Restringir y señalizar el área afectada.",
      "- Asignar responsable para ejecutar la corrección.",
      "- Definir plazo concreto y verificar cumplimiento.",
      "- Implementar medida de control adecuada al riesgo.",
      "- Registrar evidencia antes y después de la acción.",
    ]
    return lines.join("\n")
  }
  const provider = "google"
  const model = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const base =
    `Genera una accion correctiva concreta y accionable en espanol para un hallazgo de seguridad.\n` +
    `Incluye pasos claros, responsables, y plazos sugeridos.\n` +
    `Responde exclusivamente con una lista de viñetas, iniciando cada linea con "-".\n` +
    `No incluyas introducciones, encabezados, separadores ni conclusiones.\n` +
    `No uses frases como "Aqui tienes..." ni "Resumen".\n` +
    `Contexto:\n` +
    `Titulo: ${args.title || "-"}\n` +
    `Descripcion: ${args.description || "-"}\n` +
    `Severidad: ${args.severity || "-"}\n` +
    `Ubicacion: ${args.location || "-"}\n`
  const photo = Array.isArray(args.photos) && args.photos.length > 0 ? args.photos[0] : undefined
  const { text } = await generateText({
    model: getModel(provider, model, apiKey) as unknown as LanguageModel,
    messages: [
      {
        role: "user",
        content: photo
          ? [{ type: "text", text: base }, { type: "image", image: photo }]
          : [{ type: "text", text: base }],
      },
    ],
  })
  const cleaned = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*(aquí|aqui)\s+tienes[^\n]*\n?/i, "")
    .replace(/^\s*[-–—]{3,}\s*$/gm, "")
    .replace(/^\s*#{1,6}\s.*$/gm, "")
    .trim()
  return cleaned
}
