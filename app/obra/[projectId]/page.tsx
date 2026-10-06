import { notFound, redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"
import { getObraDashboard } from "@/app/actions/obra/dashboard"
import { getObraAccess } from "@/app/actions/obra/projects"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ObraDashboardContent } from "@/components/obra/obra-dashboard"
import { ObraNav } from "@/components/obra/obra-nav"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getSession } from "@/lib/auth"
import { todayISO } from "@/lib/obra/metrics"
import { can } from "@/lib/obra/permissions"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Resumen de la obra" }

export default async function ObraResumenPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const p = await params
  const id = parseIntId(p.projectId)
  if (id === null) notFound()
  const acc = await getObraAccess(id)
  if (!acc.ok) notFound()

  const dash = await getObraDashboard(id)
  const pendingApprovals = dash.ok && can(acc.data.role, "findings.view") ? dash.data.counts.pending_suggestions : 0

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ObraNav
        projectId={id}
        projectName={acc.data.project_name}
        role={acc.data.role}
        pendingApprovals={pendingApprovals}
      />
      {dash.ok ? (
        <ObraDashboardContent dashboard={dash.data} today={todayISO()} />
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No se pudo cargar el resumen de la obra</AlertTitle>
          <AlertDescription>{dash.ok === false ? dash.error : null}</AlertDescription>
        </Alert>
      )}
    </DashboardLayout>
  )
}
