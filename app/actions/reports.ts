"use server"

import { sql } from "@/lib/db"
import type { Report as DbReport } from "@/lib/db"
import { generateText } from "ai"
import type { LanguageModel } from "ai"
import { getSetting } from "./settings"
import { getModel } from "@/lib/ai"
import { getCurrentUserId } from "@/lib/auth"

export interface ReportData {
  period: string
  dateFrom: string
  dateTo: string
  documents: {
    total: number
    valid: number
    expiring: number
    expired: number
  }
  findings: {
    total: number
    open: number
    resolved: number
    critical: number
    high: number
    medium: number
    low: number
  }
  workers: {
    total: number
    withCompleteDocs: number
    withExpiredDocs: number
  }
  recentFindings: Array<{
    title: string
    severity: string
    status: string
    location: string
    created_at: string
  }>
  expiringDocuments: Array<{
    worker_name: string
    document_type: string
    expiry_date: string
  }>
}

export interface GeneratedReportSummary {
  id: number
  report_type: string
  title: string
  date_from: string
  date_to: string
  created_at: string
}

export async function getReportData(period: string, projectId?: number): Promise<ReportData> {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      period,
      dateFrom: "",
      dateTo: "",
      documents: { total: 0, valid: 0, expiring: 0, expired: 0 },
      findings: { total: 0, open: 0, resolved: 0, critical: 0, high: 0, medium: 0, low: 0 },
      workers: { total: 0, withCompleteDocs: 0, withExpiredDocs: 0 },
      recentFindings: [],
      expiringDocuments: [],
    }
  }
  let dateFrom: Date
  let dateTo = new Date()

  switch (period) {
    case "weekly":
      dateFrom = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case "last-week":
      dateTo = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000)
      dateFrom = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case "monthly":
      dateFrom = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1)
      break
    case "last-month":
      dateTo = new Date(dateTo.getFullYear(), dateTo.getMonth(), 0)
      dateFrom = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1)
      break
    default:
      dateFrom = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000)
  }

  const [documentsResult, findingsResult, workersResult, recentFindingsResult, expiringDocsResult] = await Promise.all([
    projectId
      ? sql<{ total: number; valid: number; expiring: number; expired: number }>`SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE d.status = 'valid') as valid,
            COUNT(*) FILTER (WHERE d.status = 'expiring') as expiring,
            COUNT(*) FILTER (WHERE d.status = 'expired') as expired
          FROM documents d
          JOIN workers w ON d.worker_id = w.id
          WHERE d.user_id = ${userId} AND w.project_id = ${projectId}`
      : sql<{ total: number; valid: number; expiring: number; expired: number }>`SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'valid') as valid,
            COUNT(*) FILTER (WHERE status = 'expiring') as expiring,
            COUNT(*) FILTER (WHERE status = 'expired') as expired
          FROM documents WHERE user_id = ${userId}`,
    projectId
      ? sql<{ total: number; open: number; resolved: number; critical: number; high: number; medium: number; low: number }>`SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'open') as open,
            COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
            COUNT(*) FILTER (WHERE severity = 'critical') as critical,
            COUNT(*) FILTER (WHERE severity = 'high') as high,
            COUNT(*) FILTER (WHERE severity = 'medium') as medium,
            COUNT(*) FILTER (WHERE severity = 'low') as low
          FROM findings
          WHERE user_id = ${userId} AND project_id = ${projectId} AND created_at >= ${dateFrom} AND created_at <= ${dateTo}`
      : sql<{ total: number; open: number; resolved: number; critical: number; high: number; medium: number; low: number }>`SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'open') as open,
            COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
            COUNT(*) FILTER (WHERE severity = 'critical') as critical,
            COUNT(*) FILTER (WHERE severity = 'high') as high,
            COUNT(*) FILTER (WHERE severity = 'medium') as medium,
            COUNT(*) FILTER (WHERE severity = 'low') as low
          FROM findings
          WHERE user_id = ${userId} AND created_at >= ${dateFrom} AND created_at <= ${dateTo}`,
    projectId
      ? sql<{ total: number; with_complete_docs: number; with_expired_docs: number }>`SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT w.id) FILTER (WHERE d.status = 'valid') as with_complete_docs,
            COUNT(DISTINCT w.id) FILTER (WHERE d.status = 'expired') as with_expired_docs
          FROM workers w
          LEFT JOIN documents d ON w.id = d.worker_id
          WHERE w.user_id = ${userId} AND w.project_id = ${projectId}`
      : sql<{ total: number; with_complete_docs: number; with_expired_docs: number }>`SELECT 
            COUNT(*) as total,
            COUNT(DISTINCT w.id) FILTER (WHERE d.status = 'valid') as with_complete_docs,
            COUNT(DISTINCT w.id) FILTER (WHERE d.status = 'expired') as with_expired_docs
          FROM workers w
          LEFT JOIN documents d ON w.id = d.worker_id
          WHERE w.user_id = ${userId}`,
    projectId
      ? sql<{ title: string; severity: string; status: string; location: string; created_at: string }>`SELECT title, severity, status, location, created_at
          FROM findings
          WHERE user_id = ${userId} AND project_id = ${projectId} AND created_at >= ${dateFrom} AND created_at <= ${dateTo}
          ORDER BY created_at DESC
          LIMIT 10`
      : sql<{ title: string; severity: string; status: string; location: string; created_at: string }>`SELECT title, severity, status, location, created_at
          FROM findings
          WHERE user_id = ${userId} AND created_at >= ${dateFrom} AND created_at <= ${dateTo}
          ORDER BY created_at DESC
          LIMIT 10`,
    projectId
      ? sql<{ worker_name: string; document_type: string; expiry_date: string }>`SELECT CONCAT(w.first_name, ' ', w.last_name) as worker_name, dt.name as document_type, d.expiry_date
          FROM documents d
          JOIN workers w ON d.worker_id = w.id
          LEFT JOIN document_types dt ON d.document_type_id = dt.id
          WHERE d.user_id = ${userId} AND w.project_id = ${projectId} AND d.expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND d.expiry_date >= CURRENT_DATE
          ORDER BY d.expiry_date ASC
          LIMIT 10`
      : sql<{ worker_name: string; document_type: string; expiry_date: string }>`SELECT CONCAT(w.first_name, ' ', w.last_name) as worker_name, dt.name as document_type, d.expiry_date
          FROM documents d
          JOIN workers w ON d.worker_id = w.id
          LEFT JOIN document_types dt ON d.document_type_id = dt.id
          WHERE d.user_id = ${userId} AND d.expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND d.expiry_date >= CURRENT_DATE
          ORDER BY d.expiry_date ASC
          LIMIT 10`,
  ])

  return {
    period,
    dateFrom: dateFrom.toISOString().split("T")[0],
    dateTo: dateTo.toISOString().split("T")[0],
    documents: {
      total: Number(documentsResult[0]?.total) || 0,
      valid: Number(documentsResult[0]?.valid) || 0,
      expiring: Number(documentsResult[0]?.expiring) || 0,
      expired: Number(documentsResult[0]?.expired) || 0,
    },
    findings: {
      total: Number(findingsResult[0]?.total) || 0,
      open: Number(findingsResult[0]?.open) || 0,
      resolved: Number(findingsResult[0]?.resolved) || 0,
      critical: Number(findingsResult[0]?.critical) || 0,
      high: Number(findingsResult[0]?.high) || 0,
      medium: Number(findingsResult[0]?.medium) || 0,
      low: Number(findingsResult[0]?.low) || 0,
    },
    workers: {
      total: Number(workersResult[0]?.total) || 0,
      withCompleteDocs: Number(workersResult[0]?.with_complete_docs) || 0,
      withExpiredDocs: Number(workersResult[0]?.with_expired_docs) || 0,
    },
    recentFindings: recentFindingsResult as ReportData["recentFindings"],
    expiringDocuments: expiringDocsResult as ReportData["expiringDocuments"],
  }
}

export async function generateAIReport(
  reportType: string,
  data: ReportData,
  projectId?: number,
): Promise<{ content: string; title: string; id: number }> {
  const userId = await getCurrentUserId()
  const apiKey = await getSetting("ai_api_key")
  const aiModel = (await getSetting("ai_model")) || "gemini-2.5-flash"
  const aiProvider = "google"

  if (!apiKey) {
    const reportTypeMap: Record<string, string> = {
      weekly: "Reporte Semanal de Seguridad",
      monthly: "Informe Mensual de Seguridad",
      findings: "Reporte de Hallazgos",
      docs: "Estado de Documentacion del Personal",
    }
    const title = reportTypeMap[reportType] || "Informe de Seguridad"
    const content =
      `# ${title}\n\n` +
      `Periodo: ${data.dateFrom} al ${data.dateTo}\n\n` +
      `## Resumen Ejecutivo\n` +
      `- Documentos totales: ${data.documents.total}\n` +
      `  - Vigentes: ${data.documents.valid}\n` +
      `  - Por vencer: ${data.documents.expiring}\n` +
      `  - Vencidos: ${data.documents.expired}\n\n` +
      `- Hallazgos en el periodo: ${data.findings.total}\n` +
      `  - Abiertos: ${data.findings.open}\n` +
      `  - Resueltos: ${data.findings.resolved}\n` +
      `  - Criticos: ${data.findings.critical}\n` +
      `  - Altos: ${data.findings.high}\n` +
      `  - Medios: ${data.findings.medium}\n` +
      `  - Bajos: ${data.findings.low}\n\n` +
      `- Personal registrado: ${data.workers.total}\n` +
      `  - Con documentacion completa: ${data.workers.withCompleteDocs}\n` +
      `  - Con documentos vencidos: ${data.workers.withExpiredDocs}\n\n` +
      `## Hallazgos Relevantes\n` +
      `${data.recentFindings.length ? data.recentFindings.map((f) => `- ${f.title} (${f.severity}) - ${f.status} - ${f.location}`).join("\n") : "- Sin hallazgos recientes"}\n\n` +
      `## Documentos por Vencer\n` +
      `${data.expiringDocuments.length ? data.expiringDocuments.map((d) => `- ${d.worker_name}: ${d.document_type} vence el ${d.expiry_date}`).join("\n") : "- Sin documentos por vencer en el periodo"}\n\n` +
      `## Recomendaciones\n` +
      `- Revisar hallazgos abiertos y asignar responsables.\n` +
      `- Planificar acciones para documentos próximos a vencer.\n` +
      `- Configurar la API de IA en Configuracion para informes enriquecidos.\n\n` +
      `## Conclusion\n` +
      `Se recomienda mantener la vigilancia sobre los indicadores y ejecutar acciones correctivas oportunas.`
    const inserted = await sql<{ id: number }>`
      INSERT INTO reports (report_type, title, date_from, date_to, content, generated_by, project_id)
      VALUES (${reportType}, ${title}, ${new Date(data.dateFrom)}, ${new Date(data.dateTo)}, ${JSON.stringify({ markdown: content })}::jsonb, 'Sistema (sin IA)', ${projectId || null})
      RETURNING id
    `
    const idNum = Number(inserted[0].id)
    await sql`UPDATE reports SET user_id = ${userId} WHERE id = ${idNum}`
    return { content, title, id: idNum }
  }

  const reportTypeMap: Record<string, string> = {
    weekly: "Reporte Semanal de Seguridad",
    monthly: "Informe Mensual de Seguridad",
    findings: "Reporte de Hallazgos",
    docs: "Estado de Documentacion del Personal",
  }

  const title = reportTypeMap[reportType] || "Informe de Seguridad"

  const prompt = `Genera un informe profesional de seguridad laboral en espanol con el siguiente formato:

TIPO DE INFORME: ${title}
PERIODO: ${data.dateFrom} al ${data.dateTo}

DATOS DEL SISTEMA:
- Documentos totales: ${data.documents.total}
  - Vigentes: ${data.documents.valid}
  - Por vencer: ${data.documents.expiring}
  - Vencidos: ${data.documents.expired}

- Hallazgos en el periodo: ${data.findings.total}
  - Abiertos: ${data.findings.open}
  - Resueltos: ${data.findings.resolved}
  - Criticos: ${data.findings.critical}
  - Altos: ${data.findings.high}
  - Medios: ${data.findings.medium}
  - Bajos: ${data.findings.low}

- Personal registrado: ${data.workers.total}
  - Con documentacion completa: ${data.workers.withCompleteDocs}
  - Con documentos vencidos: ${data.workers.withExpiredDocs}

HALLAZGOS RECIENTES:
${data.recentFindings.map((f) => `- ${f.title} (${f.severity}) - ${f.status} - ${f.location}`).join("\n")}

DOCUMENTOS POR VENCER:
${data.expiringDocuments.map((d) => `- ${d.worker_name}: ${d.document_type} vence el ${d.expiry_date}`).join("\n")}

Genera un informe estructurado con:
1. Resumen Ejecutivo
2. Analisis de Indicadores
3. Hallazgos Relevantes
4. Estado de Documentacion
5. Recomendaciones
6. Conclusion

El informe debe ser profesional, conciso y orientado a la accion. Usa formato Markdown.`

  try {
    const model = getModel(aiProvider, aiModel, apiKey) as unknown as LanguageModel
    const { text } = await generateText({ model, prompt })

    const inserted = await sql<{ id: number }>`
      INSERT INTO reports (report_type, title, date_from, date_to, content, generated_by, project_id)
      VALUES (${reportType}, ${title}, ${new Date(data.dateFrom)}, ${new Date(data.dateTo)}, ${JSON.stringify({ markdown: text })}::jsonb, 'Sistema', ${projectId || null})
      RETURNING id
    `
    const idNum = Number(inserted[0].id)
    await sql`UPDATE reports SET user_id = ${userId} WHERE id = ${idNum}`

    return { content: text, title, id: idNum }
  } catch (error) {
    console.error("Error generating AI report:", error)
    throw new Error("Error al generar el informe con IA. Verifica tu API Key en Configuracion.")
  }
}

export async function getGeneratedReports(projectId?: number) {
  const userId = await getCurrentUserId()
  const result = projectId
    ? await sql<GeneratedReportSummary>`
        SELECT id, report_type, title, date_from, date_to, created_at
        FROM reports
        WHERE user_id = ${userId} AND project_id = ${projectId}
        ORDER BY created_at DESC
        LIMIT 20
      `
    : await sql<GeneratedReportSummary>`
        SELECT id, report_type, title, date_from, date_to, created_at
        FROM reports
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 20
      `
  return result
}

export async function getReportById(id: number) {
  const userId = await getCurrentUserId()
  const result = await sql<DbReport>`SELECT * FROM reports WHERE id = ${id} AND user_id = ${userId}`
  return result[0]
}

export async function createManualReport(
  title: string,
  dateFrom: string,
  dateTo: string,
  markdown: string,
  projectId?: number,
) {
  const userId = await getCurrentUserId()
  if (!userId) return null
  const inserted = await sql<{ id: number }>`
    INSERT INTO reports (report_type, title, date_from, date_to, content, generated_by, project_id, user_id)
    VALUES ('manual', ${title}, ${new Date(dateFrom)}, ${new Date(dateTo)}, ${JSON.stringify({ markdown })}::jsonb, 'Usuario', ${projectId || null}, ${userId})
    RETURNING id
  `
  return inserted[0]?.id ?? null
}

export async function updateReport(
  id: number,
  fields: { title?: string; markdown?: string },
) {
  const userId = await getCurrentUserId()
  if (!userId) return false
  const current = await sql<DbReport>`SELECT * FROM reports WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
  if (!current[0]) return false
  const nextTitle = fields.title ?? current[0].title
  const nextContent =
    fields.markdown !== undefined
      ? JSON.stringify({ markdown: fields.markdown })
      : JSON.stringify(current[0].content || { markdown: "" })
  await sql`
    UPDATE reports
    SET title = ${nextTitle}, content = ${nextContent}::jsonb
    WHERE id = ${id} AND user_id = ${userId}
  `
  return true
}
