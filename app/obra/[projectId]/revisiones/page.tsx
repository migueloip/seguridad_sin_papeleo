import { notFound, redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"
import { listObraInspections } from "@/app/actions/obra/inspections"
import { listObraMembers } from "@/app/actions/obra/members"
import { getObraAccess } from "@/app/actions/obra/projects"
import { countObraPendingApprovals } from "@/app/actions/obra/suggestions"
import { DashboardLayout } from "@/components/dashboard-layout"
import { InspectionsContent } from "@/components/obra/inspections-content"
import { ObraNav } from "@/components/obra/obra-nav"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getSession } from "@/lib/auth"
import { todayISO } from "@/lib/obra/metrics"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Revisiones de la obra" }

export default async function ObraRevisionesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const p = await params
  const id = parseIntId(p.projectId)
  if (id === null) notFound()
  const acc = await getObraAccess(id)
  if (!acc.ok) notFound()
  const pendingApprovals = await countObraPendingApprovals(id)

  const [inspections, members] = await Promise.all([listObraInspections(id), listObraMembers(id)])

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ObraNav
        projectId={id}
        projectName={acc.data.project_name}
        role={acc.data.role}
        pendingApprovals={pendingApprovals.ok ? pendingApprovals.data : 0}
      />
      {inspections.ok && members.ok ? (
        <InspectionsContent
          projectId={id}
          role={acc.data.role}
          currentUserId={acc.data.user_id}
          initialInspections={inspections.data}
          members={members.data}
          today={todayISO()}
        />
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No se pudieron cargar las revisiones</AlertTitle>
          <AlertDescription>{inspections.ok === false ? inspections.error : members.ok === false ? members.error : null}</AlertDescription>
        </Alert>
      )}
    </DashboardLayout>
  )
}
