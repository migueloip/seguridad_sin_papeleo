"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

export type SearchResultType = "project" | "finding" | "document" | "worker" | "report"

export type SearchResult = {
  type: SearchResultType
  id: number
  title: string
  subtitle: string
  href: string
}

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`)
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
}

const FINDING_STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  in_progress: "En proceso",
  resolved: "Resuelto",
  closed: "Cerrado",
}

/**
 * Búsqueda global por texto en proyectos, hallazgos, documentos, personal e
 * informes del usuario actual (aislado por user_id, igual que el resto de
 * las actions). Devuelve resultados agrupables por tipo, ya ordenados.
 */
export async function globalSearch(query: string): Promise<SearchResult[]> {
  const userId = await getCurrentUserId()
  const q = query.trim()
  if (!userId || q.length < 2) return []

  const like = `%${escapeLike(q)}%`

  const [projects, findings, documents, workers, reports] = await Promise.all([
    sql<{ id: number; name: string; location: string | null; status: string }>`
      SELECT id, name, location, status
      FROM projects
      WHERE user_id = ${userId}
        AND (name ILIKE ${like} OR location ILIKE ${like} OR client ILIKE ${like})
      ORDER BY created_at DESC
      LIMIT 5
    `,
    sql<{ id: number; title: string; severity: string; status: string; project_id: number | null }>`
      SELECT id, title, severity, status, project_id
      FROM findings
      WHERE user_id = ${userId}
        AND (title ILIKE ${like} OR description ILIKE ${like} OR location ILIKE ${like})
      ORDER BY created_at DESC
      LIMIT 5
    `,
    sql<{ id: number; file_name: string; doc_type: string | null; worker_name: string | null }>`
      SELECT d.id, d.file_name,
        dt.name AS doc_type,
        NULLIF(TRIM(CONCAT(w.first_name, ' ', w.last_name)), '') AS worker_name
      FROM documents d
      LEFT JOIN document_types dt ON d.document_type_id = dt.id
      LEFT JOIN workers w ON d.worker_id = w.id
      WHERE d.user_id = ${userId}
        AND (d.file_name ILIKE ${like} OR dt.name ILIKE ${like}
             OR CONCAT(w.first_name, ' ', w.last_name) ILIKE ${like})
      ORDER BY d.created_at DESC
      LIMIT 5
    `,
    sql<{ id: number; first_name: string; last_name: string; rut: string; role: string | null }>`
      SELECT id, first_name, last_name, rut, role
      FROM workers
      WHERE user_id = ${userId}
        AND (CONCAT(first_name, ' ', last_name) ILIKE ${like} OR rut ILIKE ${like} OR role ILIKE ${like})
      ORDER BY created_at DESC
      LIMIT 5
    `,
    sql<{ id: number; title: string; report_type: string; created_at: string }>`
      SELECT id, title, report_type, created_at::text AS created_at
      FROM reports
      WHERE user_id = ${userId} AND title ILIKE ${like}
      ORDER BY created_at DESC
      LIMIT 5
    `,
  ])

  const results: SearchResult[] = []

  for (const p of projects) {
    results.push({
      type: "project",
      id: p.id,
      title: p.name,
      subtitle: p.location || "Proyecto",
      href: `/proyectos/${p.id}/documentos`,
    })
  }
  for (const f of findings) {
    results.push({
      type: "finding",
      id: f.id,
      title: f.title,
      subtitle: `#${f.id} · ${SEVERITY_LABEL[f.severity] || f.severity} · ${FINDING_STATUS_LABEL[f.status] || f.status}`,
      href: f.project_id ? `/proyectos/${f.project_id}/hallazgos` : "/hallazgos",
    })
  }
  for (const d of documents) {
    results.push({
      type: "document",
      id: d.id,
      title: d.doc_type || d.file_name,
      subtitle: d.worker_name ? `${d.worker_name} · ${d.file_name}` : d.file_name,
      href: "/documentos",
    })
  }
  for (const w of workers) {
    results.push({
      type: "worker",
      id: w.id,
      title: `${w.first_name} ${w.last_name}`.trim(),
      subtitle: [w.rut, w.role].filter(Boolean).join(" · "),
      href: "/personal",
    })
  }
  for (const r of reports) {
    results.push({
      type: "report",
      id: r.id,
      title: r.title,
      subtitle: `Informe · ${new Date(r.created_at).toLocaleDateString("es-CL")}`,
      href: `/informes/editor?id=${r.id}`,
    })
  }

  return results
}
