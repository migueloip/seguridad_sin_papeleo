import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getMobileSessionFromRequest } from "@/lib/mobile-auth"

type EntityName = "projects" | "workers" | "findings" | "mobile_documents"
type OutboxOp = "create" | "update" | "delete"

type SyncOutboxItem = {
  id: number
  entity: EntityName
  op: OutboxOp
  local_id: string
  remote_id: number | null
  payload: string
  created_at: string
}

type SyncRequestBody = {
  lastSync: string | null
  outbox: SyncOutboxItem[]
}

type IdMapEntry = { entity: EntityName; local_id: string; remote_id: number }
type Tombstone = { entity: EntityName; remote_id: number; deleted_at: string }
type SyncConflict = { outbox_id: number; entity: EntityName; remote_id: number | null; reason: string; server_row: unknown }

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function asNullableString(v: unknown): string | null {
  return typeof v === "string" ? v : v === null || v === undefined ? null : null
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback
}

function asNullableNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

async function ensureTombstonesTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS mobile_tombstones (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      entity VARCHAR(50) NOT NULL,
      remote_id INTEGER NOT NULL,
      deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_mobile_tombstones_user ON mobile_tombstones(user_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_mobile_tombstones_deleted_at ON mobile_tombstones(deleted_at)`
}

async function insertTombstone(userId: number, entity: EntityName, remoteId: number) {
  await ensureTombstonesTable()
  await sql`INSERT INTO mobile_tombstones (user_id, entity, remote_id) VALUES (${userId}, ${entity}, ${remoteId})`
}

function toDateOrNull(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request) {
  const session = await getMobileSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const userId = session.user_id
  const body = (await req.json().catch(() => null)) as SyncRequestBody | null
  if (!body || !Array.isArray(body.outbox)) return NextResponse.json({ error: "bad request" }, { status: 400 })

  const now = new Date().toISOString()
  const appliedOutboxIds: number[] = []
  const idMap: IdMapEntry[] = []
  const conflicts: SyncConflict[] = []

  for (const item of body.outbox) {
    const data = safeJsonParse(item.payload) as Record<string, unknown> | null
    if (!data) {
      conflicts.push({ outbox_id: item.id, entity: item.entity, remote_id: item.remote_id, reason: "payload inválido", server_row: null })
      continue
    }
    try {
      if (item.entity === "projects") {
        if (item.op === "create") {
          const name = asString(data.name, "")
          const location = asNullableString(data.location)
          const client = asNullableString(data.client)
          const startDate = toDateOrNull(data.start_date)
          const endDate = toDateOrNull(data.end_date)
          const status = asString(data.status, "active")
          const rows = await sql<{ id: number }>`
            INSERT INTO projects (user_id, name, location, client, start_date, end_date, status)
            VALUES (
              ${userId},
              ${name},
              ${location},
              ${client},
              ${startDate},
              ${endDate},
              ${status}
            )
            RETURNING id
          `
          const remoteId = Number(rows[0]?.id)
          if (!Number.isFinite(remoteId)) throw new Error("no id")
          idMap.push({ entity: "projects", local_id: item.local_id, remote_id: remoteId })
          appliedOutboxIds.push(item.id)
          continue
        }
        if (item.op === "update") {
          const remoteId = item.remote_id
          if (!remoteId) throw new Error("remote_id requerido")
          const server = await sql<{ updated_at: Date }>`
            SELECT updated_at FROM projects WHERE id = ${remoteId} AND user_id = ${userId} LIMIT 1
          `
          const serverUpdated = server[0]?.updated_at ? new Date(server[0].updated_at) : null
          const clientUpdated = toDateOrNull(data.updated_at)
          if (serverUpdated && clientUpdated && serverUpdated.getTime() > clientUpdated.getTime()) {
            const serverRow = await sql`SELECT * FROM projects WHERE id = ${remoteId} AND user_id = ${userId} LIMIT 1`
            conflicts.push({ outbox_id: item.id, entity: "projects", remote_id: remoteId, reason: "conflicto: servidor más reciente", server_row: serverRow[0] || null })
            continue
          }
          const name = asString(data.name, "")
          const location = asNullableString(data.location)
          const client = asNullableString(data.client)
          const startDate = toDateOrNull(data.start_date)
          const endDate = toDateOrNull(data.end_date)
          const status = asString(data.status, "active")
          await sql`
            UPDATE projects
            SET
              name = ${name},
              location = ${location},
              client = ${client},
              start_date = ${startDate},
              end_date = ${endDate},
              status = ${status},
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${remoteId} AND user_id = ${userId}
          `
          appliedOutboxIds.push(item.id)
          continue
        }
        if (item.op === "delete") {
          const remoteId = item.remote_id
          if (!remoteId) {
            appliedOutboxIds.push(item.id)
            continue
          }
          await sql`DELETE FROM projects WHERE id = ${remoteId} AND user_id = ${userId}`
          await insertTombstone(userId, "projects", remoteId)
          appliedOutboxIds.push(item.id)
          continue
        }
      }

      if (item.entity === "workers") {
        if (item.op === "create") {
          const projectId = asNullableNumber(data.project_remote_id)
          const rut = asString(data.rut, "")
          const firstName = asString(data.first_name, "")
          const lastName = asString(data.last_name, "")
          const role = asNullableString(data.role)
          const company = asNullableString(data.company)
          const phone = asNullableString(data.phone)
          const email = asNullableString(data.email)
          const status = asString(data.status, "active")
          const rows = await sql<{ id: number }>`
            INSERT INTO workers (user_id, project_id, rut, first_name, last_name, role, company, phone, email, status)
            VALUES (
              ${userId},
              ${projectId},
              ${rut},
              ${firstName},
              ${lastName},
              ${role},
              ${company},
              ${phone},
              ${email},
              ${status}
            )
            RETURNING id
          `
          const remoteId = Number(rows[0]?.id)
          if (!Number.isFinite(remoteId)) throw new Error("no id")
          idMap.push({ entity: "workers", local_id: item.local_id, remote_id: remoteId })
          appliedOutboxIds.push(item.id)
          continue
        }
        if (item.op === "update") {
          const remoteId = item.remote_id
          if (!remoteId) throw new Error("remote_id requerido")
          const server = await sql<{ updated_at: Date }>`
            SELECT updated_at FROM workers WHERE id = ${remoteId} AND user_id = ${userId} LIMIT 1
          `
          const serverUpdated = server[0]?.updated_at ? new Date(server[0].updated_at) : null
          const clientUpdated = toDateOrNull(data.updated_at)
          if (serverUpdated && clientUpdated && serverUpdated.getTime() > clientUpdated.getTime()) {
            const serverRow = await sql`SELECT * FROM workers WHERE id = ${remoteId} AND user_id = ${userId} LIMIT 1`
            conflicts.push({ outbox_id: item.id, entity: "workers", remote_id: remoteId, reason: "conflicto: servidor más reciente", server_row: serverRow[0] || null })
            continue
          }
          const projectId = asNullableNumber(data.project_remote_id)
          const rut = asString(data.rut, "")
          const firstName = asString(data.first_name, "")
          const lastName = asString(data.last_name, "")
          const role = asNullableString(data.role)
          const company = asNullableString(data.company)
          const phone = asNullableString(data.phone)
          const email = asNullableString(data.email)
          const status = asString(data.status, "active")
          await sql`
            UPDATE workers
            SET
              project_id = ${projectId},
              rut = ${rut},
              first_name = ${firstName},
              last_name = ${lastName},
              role = ${role},
              company = ${company},
              phone = ${phone},
              email = ${email},
              status = ${status},
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${remoteId} AND user_id = ${userId}
          `
          appliedOutboxIds.push(item.id)
          continue
        }
        if (item.op === "delete") {
          const remoteId = item.remote_id
          if (!remoteId) {
            appliedOutboxIds.push(item.id)
            continue
          }
          await sql`DELETE FROM workers WHERE id = ${remoteId} AND user_id = ${userId}`
          await insertTombstone(userId, "workers", remoteId)
          appliedOutboxIds.push(item.id)
          continue
        }
      }

      if (item.entity === "findings") {
        if (item.op === "create") {
          const projectId = asNullableNumber(data.project_remote_id)
          const title = asString(data.title, "")
          const description = asNullableString(data.description)
          const severity = asString(data.severity, "medium")
          const status = asString(data.status, "open")
          const location = asNullableString(data.location)
          const responsiblePerson = asNullableString(data.responsible_person)
          const dueDate = toDateOrNull(data.due_date)
          const resolutionNotes = asNullableString(data.resolution_notes)
          const photosRaw = (data as Record<string, unknown>).photos
          let photosJson: string | null = null
          if (Array.isArray(photosRaw)) {
            const arr = photosRaw.filter((p): p is string => typeof p === "string")
            if (arr.length > 0) photosJson = JSON.stringify(arr)
          } else if (typeof photosRaw === "string" && photosRaw) {
            photosJson = JSON.stringify([photosRaw])
          }
          const rows = await sql<{ id: number }>`
            INSERT INTO findings (
              user_id, project_id, title, description, severity, location, responsible_person, due_date, resolution_notes, status, photos
            )
            VALUES (
              ${userId},
              ${projectId},
              ${title},
              ${description},
              ${severity},
              ${location},
              ${responsiblePerson},
              ${dueDate},
              ${resolutionNotes},
              ${status},
              ${photosJson}::jsonb
            )
            RETURNING id
          `
          const remoteId = Number(rows[0]?.id)
          if (!Number.isFinite(remoteId)) throw new Error("no id")
          idMap.push({ entity: "findings", local_id: item.local_id, remote_id: remoteId })
          appliedOutboxIds.push(item.id)
          continue
        }
        if (item.op === "update") {
          const remoteId = item.remote_id
          if (!remoteId) throw new Error("remote_id requerido")
          const server = await sql<{ updated_at: Date }>`
            SELECT updated_at FROM findings WHERE id = ${remoteId} AND user_id = ${userId} LIMIT 1
          `
          const serverUpdated = server[0]?.updated_at ? new Date(server[0].updated_at) : null
          const clientUpdated = toDateOrNull(data.updated_at)
          if (serverUpdated && clientUpdated && serverUpdated.getTime() > clientUpdated.getTime()) {
            const serverRow = await sql`SELECT * FROM findings WHERE id = ${remoteId} AND user_id = ${userId} LIMIT 1`
            conflicts.push({ outbox_id: item.id, entity: "findings", remote_id: remoteId, reason: "conflicto: servidor más reciente", server_row: serverRow[0] || null })
            continue
          }
          const projectId = asNullableNumber(data.project_remote_id)
          const title = asString(data.title, "")
          const description = asNullableString(data.description)
          const severity = asString(data.severity, "medium")
          const status = asString(data.status, "open")
          const location = asNullableString(data.location)
          const responsiblePerson = asNullableString(data.responsible_person)
          const dueDate = toDateOrNull(data.due_date)
          const resolutionNotes = asNullableString(data.resolution_notes)
          const photosRaw = (data as Record<string, unknown>).photos
          let photosJson: string | null = null
          if (Array.isArray(photosRaw)) {
            const arr = photosRaw.filter((p): p is string => typeof p === "string")
            if (arr.length > 0) photosJson = JSON.stringify(arr)
          } else if (typeof photosRaw === "string" && photosRaw) {
            photosJson = JSON.stringify([photosRaw])
          }
          await sql`
            UPDATE findings
            SET
              project_id = ${projectId},
              title = ${title},
              description = ${description},
              severity = ${severity},
              location = ${location},
              responsible_person = ${responsiblePerson},
              due_date = ${dueDate},
              resolution_notes = ${resolutionNotes},
              status = ${status},
              photos = COALESCE(${photosJson}::jsonb, photos),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${remoteId} AND user_id = ${userId}
          `
          appliedOutboxIds.push(item.id)
          continue
        }
        if (item.op === "delete") {
          const remoteId = item.remote_id
          if (!remoteId) {
            appliedOutboxIds.push(item.id)
            continue
          }
          await sql`DELETE FROM findings WHERE id = ${remoteId} AND user_id = ${userId}`
          await insertTombstone(userId, "findings", remoteId)
          appliedOutboxIds.push(item.id)
          continue
        }
      }

      if (item.entity === "mobile_documents") {
        if (item.op === "create") {
          const projectId = asNullableNumber(data.project_remote_id)
          const title = asString(data.title, "")
          const description = asNullableString(data.description)
          const photosRaw = (data as Record<string, unknown>).photos
          let photosJson: string | null = null
          if (Array.isArray(photosRaw)) {
            const arr = photosRaw.filter((p): p is string => typeof p === "string")
            if (arr.length > 0) photosJson = JSON.stringify(arr)
          } else if (typeof photosRaw === "string" && photosRaw) {
            photosJson = JSON.stringify([photosRaw])
          }
          const rows = await sql<{ id: number }>`
            INSERT INTO mobile_documents (
              user_id, project_id, title, description, photos
            )
            VALUES (
              ${userId},
              ${projectId},
              ${title},
              ${description},
              ${photosJson}::jsonb
            )
            RETURNING id
          `
          const remoteId = Number(rows[0]?.id)
          if (!Number.isFinite(remoteId)) throw new Error("no id")
          idMap.push({ entity: "mobile_documents", local_id: item.local_id, remote_id: remoteId })
          appliedOutboxIds.push(item.id)
          continue
        }
        if (item.op === "update") {
          const remoteId = item.remote_id
          if (!remoteId) throw new Error("remote_id requerido")
          const server = await sql<{ updated_at: Date }>`
            SELECT updated_at FROM mobile_documents WHERE id = ${remoteId} AND user_id = ${userId} LIMIT 1
          `
          const serverUpdated = server[0]?.updated_at ? new Date(server[0].updated_at) : null
          const clientUpdated = toDateOrNull(data.updated_at)
          if (serverUpdated && clientUpdated && serverUpdated.getTime() > clientUpdated.getTime()) {
            const serverRow = await sql`SELECT * FROM mobile_documents WHERE id = ${remoteId} AND user_id = ${userId} LIMIT 1`
            conflicts.push({ outbox_id: item.id, entity: "mobile_documents", remote_id: remoteId, reason: "conflicto: servidor más reciente", server_row: serverRow[0] || null })
            continue
          }
          const projectId = asNullableNumber(data.project_remote_id)
          const title = asString(data.title, "")
          const description = asNullableString(data.description)
          const photosRaw = (data as Record<string, unknown>).photos
          let photosJson: string | null = null
          if (Array.isArray(photosRaw)) {
            const arr = photosRaw.filter((p): p is string => typeof p === "string")
            if (arr.length > 0) photosJson = JSON.stringify(arr)
          } else if (typeof photosRaw === "string" && photosRaw) {
            photosJson = JSON.stringify([photosRaw])
          }
          await sql`
            UPDATE mobile_documents
            SET
              project_id = ${projectId},
              title = ${title},
              description = ${description},
              photos = COALESCE(${photosJson}::jsonb, photos),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${remoteId} AND user_id = ${userId}
          `
          appliedOutboxIds.push(item.id)
          continue
        }
        if (item.op === "delete") {
          const remoteId = item.remote_id
          if (!remoteId) {
            appliedOutboxIds.push(item.id)
            continue
          }
          await sql`DELETE FROM mobile_documents WHERE id = ${remoteId} AND user_id = ${userId}`
          await insertTombstone(userId, "mobile_documents", remoteId)
          appliedOutboxIds.push(item.id)
          continue
        }
      }

      conflicts.push({ outbox_id: item.id, entity: item.entity, remote_id: item.remote_id, reason: "entidad no soportada", server_row: null })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "error"
      conflicts.push({ outbox_id: item.id, entity: item.entity, remote_id: item.remote_id, reason: message, server_row: null })
    }
  }

  const lastSyncDate = toDateOrNull(body.lastSync) || new Date(0)

  const projects = await sql<{
    id: number
    name: string
    location: string | null
    client: string | null
    start_date: string | null
    end_date: string | null
    status: string
    created_at: string
    updated_at: string
  }>`
    SELECT
      id,
      name,
      location,
      client,
      start_date::text as start_date,
      end_date::text as end_date,
      status,
      created_at::text as created_at,
      updated_at::text as updated_at
    FROM projects
    WHERE user_id = ${userId}
      AND updated_at > ${lastSyncDate}
  `

  const workers = await sql<{
    id: number
    project_id: number | null
    rut: string
    first_name: string
    last_name: string
    role: string | null
    company: string | null
    phone: string | null
    email: string | null
    status: string
    created_at: string
    updated_at: string
  }>`
    SELECT
      id,
      project_id,
      rut,
      first_name,
      last_name,
      role,
      company,
      phone,
      email,
      status,
      created_at::text as created_at,
      updated_at::text as updated_at
    FROM workers
    WHERE user_id = ${userId}
      AND updated_at > ${lastSyncDate}
  `

  const findings = await sql<{
    id: number
    project_id: number | null
    title: string
    description: string | null
    severity: string
    status: string
    location: string | null
    responsible_person: string | null
    due_date: string | null
    resolution_notes: string | null
    photos: string[] | null
    created_at: string
    updated_at: string
  }>`
    SELECT
      id,
      project_id,
      title,
      description,
      severity,
      status,
      location,
      responsible_person,
      due_date::text as due_date,
      resolution_notes,
      photos,
      created_at::text as created_at,
      updated_at::text as updated_at
    FROM findings
    WHERE user_id = ${userId}
      AND updated_at > ${lastSyncDate}
  `

  const mobileDocuments = await sql<{
    id: number
    project_id: number | null
    title: string
    description: string | null
    photos: string[] | null
    created_at: string
    updated_at: string
  }>`
    SELECT
      id,
      project_id,
      title,
      description,
      photos,
      created_at::text as created_at,
      updated_at::text as updated_at
    FROM mobile_documents
    WHERE user_id = ${userId}
      AND updated_at > ${lastSyncDate}
  `

  const admonitions = await sql<{
    id: number
    worker_id: number | null
    admonition_date: string
    admonition_type: string
    reason: string
    status: string
    approval_status: string
    created_at: string
    updated_at: string
  }>`
    SELECT
      id,
      worker_id,
      admonition_date::text as admonition_date,
      admonition_type,
      reason,
      status,
      approval_status,
      created_at::text as created_at,
      updated_at::text as updated_at
    FROM admonitions
    WHERE user_id = ${userId}
  `

  await ensureTombstonesTable()
  const tombstones = await sql<Tombstone>`
    SELECT entity, remote_id, deleted_at::text as deleted_at
    FROM mobile_tombstones
    WHERE user_id = ${userId}
      AND deleted_at > ${lastSyncDate}
  `

  return NextResponse.json({
    now,
    appliedOutboxIds,
    idMap,
    changes: { projects, workers, findings, mobile_documents: mobileDocuments, admonitions },
    tombstones,
    conflicts,
  })
}
