import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { DashboardLayout } from "@/components/dashboard-layout"

export default async function AdminPage() {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  if ((session as any).role !== "admin") redirect("/")

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Panel de Administración</h1>
        <p className="text-muted-foreground">Gestión avanzada del sistema.</p>
      </div>
    </DashboardLayout>
  )
}

