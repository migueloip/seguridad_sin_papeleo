import { notFound, redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"
import { listObraLayers } from "@/app/actions/obra/layers"
import { getObraAccess } from "@/app/actions/obra/projects"
import { countObraPendingApprovals, listObraSuggestions } from "@/app/actions/obra/suggestions"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ApprovalsContent } from "@/components/obra/approvals-content"
import { ObraNav } from "@/components/obra/obra-nav"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/obra/permissions"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Aprobaciones IA" }

/** Bandeja de sugerencias de IA con aprobación humana (requiere findings.view). */
export default async function ObraAprobacionesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const p = await params
  const id = parseIntId(p.projectId)
  if (id === null) notFound()
  const acc = await getObraAccess(id)
  if (!acc.ok) notFound()
  if (!can(acc.data.role, "findings.view") || !acc.data.permissions.includes("findings.view")) notFound()

  const [pending, layers, pendingCount] = await Promise.all([
    listObraSuggestions(id, { status: ["pending"], limit: 200 }),
    listObraLayers(id),
    countObraPendingApprovals(id),
  ])

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ObraNav
        projectId={id}
        projectName={acc.data.project_name}
        role={acc.data.role}
        pendingApprovals={pendingCount.ok ? pendingCount.data : 0}
      />
      {pending.ok ? (
        <ApprovalsContent
          projectId={id}
          role={acc.data.role}
          initialSuggestions={pending.data}
          layers={layers.ok ? layers.data : []}
        />
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No se pudieron cargar las sugerencias</AlertTitle>
          <AlertDescription>{pending.ok === false ? pending.error : null}</AlertDescription>
        </Alert>
      )}
    </DashboardLayout>
  )
}
