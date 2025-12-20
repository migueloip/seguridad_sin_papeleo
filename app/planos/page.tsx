import { DashboardLayout } from "@/components/dashboard-layout"
import { PlansContent } from "@/components/plans-content"
import { getSession } from "@/lib/auth"
import { getProjects } from "@/app/actions/projects"
import { getPlans } from "@/app/actions/plans"
import { redirect } from "next/navigation"

export default async function PlanosPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const rawProjects = await getProjects()
  type UnknownRecord = Record<string, unknown>
  const projects = (rawProjects || [])
    .map((p: unknown) => {
      const rec = p as UnknownRecord
      const id = typeof rec.id === "number" ? rec.id : Number(rec.id)
      const name = typeof rec.name === "string" ? rec.name : ""
      if (!Number.isFinite(id) || !name) return null
      return { id, name }
    })
    .filter((p): p is { id: number; name: string } => p !== null)
  const plans = await getPlans()
  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <PlansContent projects={projects} plans={plans} />
    </DashboardLayout>
  )
}
