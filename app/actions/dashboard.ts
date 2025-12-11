"use server"

import { sql } from "@/lib/db"

export async function getDashboardStats() {
  const [documentsResult, findingsResult, workersResult, expiringDocsResult, recentFindingsResult] = await Promise.all([
    sql`SELECT 
          COUNT(*) FILTER (WHERE status = 'valid') as valid,
          COUNT(*) FILTER (WHERE status = 'expiring') as expiring,
          COUNT(*) FILTER (WHERE status = 'expired') as expired
        FROM documents`,
    sql`SELECT 
          COUNT(*) FILTER (WHERE status = 'open') as open,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved
        FROM findings`,
    sql`SELECT COUNT(*) as total FROM workers WHERE status = 'active'`,
    sql`SELECT d.*, w.first_name, w.last_name, dt.name as document_type
        FROM documents d
        JOIN workers w ON d.worker_id = w.id
        LEFT JOIN document_types dt ON d.document_type_id = dt.id
        WHERE d.expiry_date IS NOT NULL 
        AND d.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        AND d.expiry_date >= CURRENT_DATE
        ORDER BY d.expiry_date ASC
        LIMIT 5`,
    sql`SELECT f.*, p.name as project_name
        FROM findings f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE f.status IN ('open', 'in_progress')
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
  const result = await sql`
    SELECT 
      TO_CHAR(created_at, 'Dy') as day,
      COUNT(*) FILTER (WHERE severity = 'critical') as critical,
      COUNT(*) FILTER (WHERE severity = 'high') as high,
      COUNT(*) FILTER (WHERE severity = 'medium') as medium,
      COUNT(*) FILTER (WHERE severity = 'low') as low
    FROM findings
    WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY TO_CHAR(created_at, 'Dy'), DATE(created_at)
    ORDER BY DATE(created_at)
  `
  return result
}
