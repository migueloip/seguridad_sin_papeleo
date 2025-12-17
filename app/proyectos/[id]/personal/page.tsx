import { DashboardLayout } from "@/components/dashboard-layout"
import { PersonnelContent } from "@/components/personnel-content"
import { getWorkers } from "@/app/actions/workers"
import { getProjectById } from "@/app/actions/projects"
import { getSession } from "@/lib/auth"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export default async function ProjectPersonnelPage({ params }: { params: { id: string } }) {
  const id = parseIntId(String(params.id || "")) ?? NaN
  if (!Number.isFinite(id)) notFound()
  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const workers = await getWorkers(id)

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <PersonnelContent initialWorkers={workers as any} />
    </DashboardLayout>
  )
}
