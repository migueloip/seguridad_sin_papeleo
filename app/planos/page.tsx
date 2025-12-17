import { DashboardLayout } from "@/components/dashboard-layout"
import { PlansContent } from "@/components/plans-content"
import { getSession } from "@/lib/auth"
import { getProjects } from "@/app/actions/projects"

export default async function PlanosPage() {
  const [session, projects] = await Promise.all([getSession(), getProjects()])
  return (
    <DashboardLayout user={session as any}>
      <PlansContent projects={projects as any} />
    </DashboardLayout>
  )
}
