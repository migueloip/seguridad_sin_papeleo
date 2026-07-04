"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { getSetting, updateSetting } from "./settings"

export type NotificationItem = {
  key: string
  type: "document" | "finding"
  title: string
  message: string
  severity: "danger" | "warning"
  href: string
  created_at: string
}

const READ_KEY = "notifications_read_at"

/**
 * Notificaciones reales derivadas de los datos del usuario (RLS las aísla por tenant):
 * documentos por vencer / vencidos y hallazgos abiertos críticos / atrasados.
 * El estado leído/no-leído se persiste con un timestamp en settings (por usuario).
 */
export async function getNotifications(): Promise<{ items: NotificationItem[]; unread: number }> {
  const userId = await getCurrentUserId()
  if (!userId) return { items: [], unread: 0 }

  const [docs, finds, readAtRaw] = await Promise.all([
    sql<{
      id: number
      doc_type: string
      worker_name: string | null
      days_until: number
      created_at: string
    }>`
      SELECT
        d.id,
        COALESCE(dt.name, 'Documento') as doc_type,
        NULLIF(TRIM(CONCAT(w.first_name, ' ', w.last_name)), '') as worker_name,
        (d.expiry_date::date - CURRENT_DATE)::int as days_until,
        d.created_at::text as created_at
      FROM documents d
      LEFT JOIN workers w ON d.worker_id = w.id
      LEFT JOIN document_types dt ON d.document_type_id = dt.id
      WHERE d.user_id = ${userId}
        AND d.expiry_date IS NOT NULL
        AND d.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY d.expiry_date ASC
      LIMIT 8
    `,
    sql<{ id: number; title: string; severity: string; created_at: string; days_to_due: number | null }>`
      SELECT
        f.id,
        f.title,
        f.severity,
        f.created_at::text as created_at,
        (CASE WHEN f.due_date IS NOT NULL THEN (f.due_date::date - CURRENT_DATE)::int ELSE NULL END) as days_to_due
      FROM findings f
      WHERE f.user_id = ${userId}
        AND f.status IN ('open', 'in_progress')
        AND (f.severity IN ('critical', 'high') OR (f.due_date IS NOT NULL AND f.due_date < CURRENT_DATE))
      ORDER BY CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, f.created_at DESC
      LIMIT 8
    `,
    getSetting(READ_KEY),
  ])

  const items: NotificationItem[] = []

  for (const d of docs) {
    const days = Number(d.days_until)
    const expired = days < 0
    const who = d.worker_name ? ` de ${d.worker_name}` : ""
    const when = expired
      ? `vencido hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`
      : days === 0
        ? "vence hoy"
        : `vence en ${days} día${days === 1 ? "" : "s"}`
    items.push({
      key: `doc-${d.id}`,
      type: "document",
      title: expired ? "Documento vencido" : "Documento por vencer",
      message: `${d.doc_type}${who} · ${when}`,
      severity: expired || days <= 7 ? "danger" : "warning",
      href: "/documentos",
      created_at: d.created_at,
    })
  }

  for (const f of finds) {
    const overdue = f.days_to_due != null && Number(f.days_to_due) < 0
    items.push({
      key: `finding-${f.id}`,
      type: "finding",
      title:
        f.severity === "critical"
          ? "Hallazgo crítico abierto"
          : overdue
            ? "Hallazgo atrasado"
            : "Hallazgo de alta prioridad",
      message: `#${f.id} · ${f.title}`,
      severity: f.severity === "critical" || overdue ? "danger" : "warning",
      href: "/hallazgos",
      created_at: f.created_at,
    })
  }

  items.sort((a, b) =>
    a.severity === b.severity
      ? a.created_at < b.created_at
        ? 1
        : -1
      : a.severity === "danger"
        ? -1
        : 1,
  )
  const top = items.slice(0, 12)

  const readAt = readAtRaw ? new Date(readAtRaw).getTime() : 0
  const unread = top.filter((i) => new Date(i.created_at).getTime() > readAt).length

  return { items: top, unread }
}

export async function markNotificationsRead(): Promise<void> {
  const userId = await getCurrentUserId()
  if (!userId) return
  await updateSetting(READ_KEY, new Date().toISOString())
}
