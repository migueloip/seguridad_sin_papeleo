import { redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"
import { listMyObraProjects } from "@/app/actions/obra/projects"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectHub } from "@/components/obra/project-hub"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getSession } from "@/lib/auth"
import { todayISO } from "@/lib/obra/metrics"

export const metadata = { title: "Obra integral" }

export default async function ObraHubPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")

  const res = await listMyObraProjects()

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      {res.ok ? (
        <ProjectHub projects={res.data} today={todayISO()} />
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No se pudieron cargar tus obras</AlertTitle>
          <AlertDescription>{res.ok === false ? res.error : null}</AlertDescription>
        </Alert>
      )}
    </DashboardLayout>
  )
}
