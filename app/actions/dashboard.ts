"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

export interface DashboardStats {
  projects: {
    total: number
    active: number
  }
  workers: {
    total: number
    active: number
  }
  documents: {
    total: number
    valid: number
    expiring: number
    expired: number
  }
  findings: {
    total: number
    open: number
    in_progress: number
    resolved: number
    critical: number
  }
  recentActivity: Array<{
    id: number
    type: "document" | "finding" | "worker" | "project"
    action: string
    description: string
    created_at: string
  }>
  upcomingExpirations: Array<{
    id: number
    file_name: string
    worker_name: string
    document_type: string
    expiry_date: string
    days_until: number
  }>
  findingsWeekly: Array<{
    semana: string
    abiertos: number
    cerrados: number
  }>
  riskByLocation: Array<{
    location: string
    score: number
    openCount: number
    critical: number
    high: number
    medium: number
    low: number
  }>
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      projects: { total: 0, active: 0 },
      workers: { total: 0, active: 0 },
      documents: { total: 0, valid: 0, expiring: 0, expired: 0 },
      findings: { total: 0, open: 0, in_progress: 0, resolved: 0, critical: 0 },
      recentActivity: [],
      upcomingExpirations: [],
      findingsWeekly: [],
      riskByLocation: [],
    }
  }

  // Fetch all stats in parallel
  const [
    projectStats,
    workerStats,
    documentStats,
    findingStats,
    upcomingExpirations,
    findingsWeekly,
    riskByLocation,
  ] = await Promise.all([
    // Project stats
    sql<{ total: number; active: number }[]>`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'active')::int as active
      FROM projects WHERE user_id = ${userId}
    `,
    // Worker stats
    sql<{ total: number; active: number }[]>`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'active')::int as active
      FROM workers WHERE user_id = ${userId}
    `,
    // Document stats
    sql<{ total: number; valid: number; expiring: number; expired: number }[]>`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'valid')::int as valid,
        COUNT(*) FILTER (WHERE status = 'expiring_soon')::int as expiring,
        COUNT(*) FILTER (WHERE status = 'expired')::int as expired
      FROM documents WHERE user_id = ${userId}
    `,
    // Finding stats
    sql<{ total: number; open: number; in_progress: number; resolved: number; critical: number }[]>`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'open')::int as open,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int as in_progress,
        COUNT(*) FILTER (WHERE status IN ('resolved', 'closed'))::int as resolved,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status NOT IN ('resolved', 'closed'))::int as critical
      FROM findings WHERE user_id = ${userId}
    `,
    // Upcoming expirations (next 30 days)
    sql<{ id: number; file_name: string; worker_name: string; document_type: string; expiry_date: string; days_until: number }[]>`
      SELECT 
        d.id,
        d.file_name,
        CONCAT(w.first_name, ' ', w.last_name) as worker_name,
        COALESCE(dt.name, 'Sin tipo') as document_type,
        d.expiry_date::text,
        (d.expiry_date::date - CURRENT_DATE)::int as days_until
      FROM documents d
      LEFT JOIN workers w ON d.worker_id = w.id
      LEFT JOIN document_types dt ON d.document_type_id = dt.id
      WHERE d.user_id = ${userId}
        AND d.expiry_date IS NOT NULL
        AND d.expiry_date >= CURRENT_DATE
        AND d.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY d.expiry_date ASC
      LIMIT 5
    `,
    // Findings weekly (last 8 weeks)
    sql<{ semana: string; abiertos: number; cerrados: number }[]>`
      WITH weeks AS (
        SELECT generate_series(
          date_trunc('week', CURRENT_DATE - INTERVAL '7 weeks'),
          date_trunc('week', CURRENT_DATE),
          '1 week'::interval
        )::date as week_start
      )
      SELECT 
        TO_CHAR(w.week_start, 'DD/MM') as semana,
        COALESCE(SUM(CASE WHEN f.status IN ('open', 'in_progress') THEN 1 ELSE 0 END), 0)::int as abiertos,
        COALESCE(SUM(CASE WHEN f.status IN ('resolved', 'closed') THEN 1 ELSE 0 END), 0)::int as cerrados
      FROM weeks w
      LEFT JOIN findings f ON 
        f.user_id = ${userId} AND
        date_trunc('week', f.created_at::date) = w.week_start
      GROUP BY w.week_start
      ORDER BY w.week_start
    `,
    // Risk by location
    sql<{ location: string; score: number; openCount: number; critical: number; high: number; medium: number; low: number }[]>`
      SELECT
        COALESCE(location, 'Sin ubicación') as location,
        (
          COUNT(*) FILTER (WHERE severity = 'critical') * 4 +
          COUNT(*) FILTER (WHERE severity = 'high') * 3 +
          COUNT(*) FILTER (WHERE severity = 'medium') * 2 +
          COUNT(*) FILTER (WHERE severity = 'low') * 1
        )::int as score,
        COUNT(*)::int as "openCount",
        COUNT(*) FILTER (WHERE severity = 'critical')::int as critical,
        COUNT(*) FILTER (WHERE severity = 'high')::int as high,
        COUNT(*) FILTER (WHERE severity = 'medium')::int as medium,
        COUNT(*) FILTER (WHERE severity = 'low')::int as low
      FROM findings
      WHERE user_id = ${userId} AND status NOT IN ('resolved', 'closed')
      GROUP BY location
      ORDER BY score DESC
      LIMIT 5
    `,
  ])

  return {
    projects: projectStats[0] || { total: 0, active: 0 },
    workers: workerStats[0] || { total: 0, active: 0 },
    documents: documentStats[0] || { total: 0, valid: 0, expiring: 0, expired: 0 },
    findings: findingStats[0] || { total: 0, open: 0, in_progress: 0, resolved: 0, critical: 0 },
    recentActivity: [],
    upcomingExpirations: upcomingExpirations.map((e) => ({
      ...e,
      days_until: Number(e.days_until),
    })),
    findingsWeekly: findingsWeekly.map((w) => ({
      semana: w.semana,
      abiertos: Number(w.abiertos),
      cerrados: Number(w.cerrados),
    })),
    riskByLocation: riskByLocation.map((r) => ({
      location: r.location,
      score: Number(r.score),
      openCount: Number(r.openCount),
      critical: Number(r.critical),
      high: Number(r.high),
      medium: Number(r.medium),
      low: Number(r.low),
    })),
  }
}
