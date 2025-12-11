"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

export async function getDashboardStats() {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      documents: { valid: 0, expiring: 0, expired: 0 },
      findings: { open: 0, in_progress: 0, resolved: 0 },
      workers: 0,
      expiringDocs: [],
      recentFindings: [],
    }
  }
  const [documentsResult, findingsResult, workersResult, expiringDocsResult, recentFindingsResult] = await Promise.all([
    sql<{ valid: number; expiring: number; expired: number }>`SELECT 
          COUNT(*) FILTER (WHERE status = 'valid') as valid,
          COUNT(*) FILTER (WHERE status = 'expiring') as expiring,
          COUNT(*) FILTER (WHERE status = 'expired') as expired
        FROM documents WHERE user_id = ${userId}`,
    sql<{ open: number; in_progress: number; resolved: number }>`SELECT 
          COUNT(*) FILTER (WHERE status = 'open') as open,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved
        FROM findings WHERE user_id = ${userId}`,
    sql<{ total: number }>`SELECT COUNT(*) as total FROM workers WHERE status = 'active' AND user_id = ${userId}`,
    sql<{ id: number; first_name: string; last_name: string; document_type: string; expiry_date: string }>`SELECT d.*, w.first_name, w.last_name, dt.name as document_type
        FROM documents d
        JOIN workers w ON d.worker_id = w.id
        LEFT JOIN document_types dt ON d.document_type_id = dt.id
        WHERE d.user_id = ${userId} AND d.expiry_date IS NOT NULL 
        AND d.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        AND d.expiry_date >= CURRENT_DATE
        ORDER BY d.expiry_date ASC
        LIMIT 5`,
    sql<{ id: number; title: string; severity: string; status: string; project_name: string; created_at: string }>`SELECT f.*, p.name as project_name
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE f.user_id = ${userId} AND f.status IN ('open', 'in_progress')
        ORDER BY 
          CASE f.severity 
            WHEN 'critical' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'medium' THEN 3 
            ELSE 4 
          END,
          f.created_at DESC
        LIMIT 5`,
  ])

  return {
    documents: documentsResult[0] || { valid: 0, expiring: 0, expired: 0 },
    findings: findingsResult[0] || { open: 0, in_progress: 0, resolved: 0 },
    workers: workersResult[0]?.total || 0,
    expiringDocs: expiringDocsResult || [],
    recentFindings: recentFindingsResult || [],
  }
}

export async function getWeeklyFindingsData() {
  const userId = await getCurrentUserId()
  const result = await sql`
    SELECT 
      TO_CHAR(created_at, 'Dy') as day,
      COUNT(*) FILTER (WHERE severity = 'critical') as critical,
      COUNT(*) FILTER (WHERE severity = 'high') as high,
      COUNT(*) FILTER (WHERE severity = 'medium') as medium,
      COUNT(*) FILTER (WHERE severity = 'low') as low
    FROM findings
    WHERE user_id = ${userId} AND created_at >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY TO_CHAR(created_at, 'Dy'), DATE(created_at)
    ORDER BY DATE(created_at)
  `
  return result
}

export async function getWeeklyFindingsOpenClosed() {
  const userId = await getCurrentUserId()
  if (!userId) return []
  const result = await sql`
    WITH weeks AS (
      SELECT 
        date_trunc('week', created_at) AS week_start,
        COUNT(*) FILTER (WHERE status IN ('open','in_progress')) AS abiertos,
        COUNT(*) FILTER (WHERE status IN ('resolved','closed')) AS cerrados
      FROM findings
      WHERE user_id = ${userId} AND created_at >= CURRENT_DATE - INTERVAL '28 days'
      GROUP BY 1
      ORDER BY 1
    )
    SELECT to_char(week_start, '"Sem "IW') AS semana, abiertos, cerrados
    FROM weeks
  `
  return result
}
