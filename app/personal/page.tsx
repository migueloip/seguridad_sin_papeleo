import { DashboardLayout } from "@/components/dashboard-layout"
import { PersonnelContent } from "@/components/personnel-content"
import { getWorkers } from "@/app/actions/workers"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function PersonnelPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const workers = await getWorkers()

  return (
    <DashboardLayout
      user={session ? { email: String(session.email), name: session.name ?? null, role: session.role ?? null } : undefined}
    >
      <PersonnelContent initialWorkers={workers} />
    </DashboardLayout>
  )
}
