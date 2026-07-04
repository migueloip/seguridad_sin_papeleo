import { DashboardLayout } from "@/components/dashboard-layout"
import ReportsContentClient from "@/components/reports-content-client"
import { getGeneratedReports } from "@/app/actions/reports"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export const metadata = { title: "Editor de informe" }

export default async function ReportsEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const sp = await searchParams
  const reportId = sp.id && /^\d+$/.test(sp.id) ? Number(sp.id) : undefined
  const reports = await getGeneratedReports()

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ReportsContentClient initialReports={reports} reportId={reportId} />
    </DashboardLayout>
  )
}
