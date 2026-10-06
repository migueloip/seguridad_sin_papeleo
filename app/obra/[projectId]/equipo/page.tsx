import { notFound, redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"
import { listObraLinkableWorkers, listObraMembers } from "@/app/actions/obra/members"
import { getObraAccess } from "@/app/actions/obra/projects"
import { countObraPendingApprovals } from "@/app/actions/obra/suggestions"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ObraNav } from "@/components/obra/obra-nav"
import { TeamContent } from "@/components/obra/team-content"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/obra/permissions"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Equipo de la obra" }

export default async function ObraEquipoPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const p = await params
  const id = parseIntId(p.projectId)
  if (id === null) notFound()
  const acc = await getObraAccess(id)
  if (!acc.ok) notFound()
  const pendingApprovals = await countObraPendingApprovals(id)

  const canManage = can(acc.data.role, "members.manage")
  const [members, workers] = await Promise.all([
    listObraMembers(id),
    canManage ? listObraLinkableWorkers(id) : Promise.resolve(null),
  ])

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ObraNav
        projectId={id}
        projectName={acc.data.project_name}
        role={acc.data.role}
        pendingApprovals={pendingApprovals.ok ? pendingApprovals.data : 0}
      />
      {members.ok ? (
        <TeamContent
          projectId={id}
          role={acc.data.role}
          currentUserId={acc.data.user_id}
          initialMembers={members.data}
          linkableWorkers={workers && workers.ok ? workers.data : null}
        />
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No se pudo cargar el equipo</AlertTitle>
          <AlertDescription>{members.ok === false ? members.error : null}</AlertDescription>
        </Alert>
      )}
    </DashboardLayout>
  )
}
