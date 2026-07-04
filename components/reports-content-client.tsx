"use client"

import dynamic from "next/dynamic"
import type { GeneratedReportSummary } from "@/app/actions/reports"

const DynamicReportsContent = dynamic(
  () => import("@/components/reports-content").then((m) => m.ReportsContent),
  { ssr: false },
)

export default function ReportsContentClient({
  initialReports,
  projectId,
  reportId,
}: {
  initialReports?: GeneratedReportSummary[]
  projectId?: number
  reportId?: number
}) {
  return <DynamicReportsContent initialReports={initialReports} projectId={projectId} reportId={reportId} />
}
