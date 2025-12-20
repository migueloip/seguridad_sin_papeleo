import { DashboardLayout } from "@/components/dashboard-layout"
import { PlansContent } from "@/components/plans-content"
import { getSession } from "@/lib/auth"
import { getProjectById } from "@/app/actions/projects"
import { notFound, redirect } from "next/navigation"
import { parseIntId } from "@/lib/route"

export default async function ProjectPlanosPage({ params }: { params: Promise<{ id: string }> }) {
  const p = await params
  const parsed = parseIntId(p.id)
  if (parsed === null) notFound()
  const id = parsed

  const [session, project] = await Promise.all([getSession(), getProjectById(id)])
  if (!session) redirect("/auth/login")
  if (!project) notFound()

  const name =
    typeof (project as { name?: unknown }).name === "string" ? String((project as { name?: unknown }).name) : ""

  const projects = [{ id, name }]

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <PlansContent projects={projects} />
    </DashboardLayout>
  )
}

