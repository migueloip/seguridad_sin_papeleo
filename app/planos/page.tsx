import { DashboardLayout } from "@/components/dashboard-layout"
import { PlansContent } from "@/components/plans-content"
import { getSession } from "@/lib/auth"
import { getProjects } from "@/app/actions/projects"
import { redirect } from "next/navigation"

export default async function PlanosPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const projects = await getProjects()
  return (
    <DashboardLayout user={session as any}>
      <PlansContent projects={projects as any} />
    </DashboardLayout>
  )
}
