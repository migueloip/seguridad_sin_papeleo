import { DashboardLayout } from "@/components/dashboard-layout"
import { requireAdmin } from "@/app/actions/admin"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default async function AdminPage() {
  await requireAdmin()

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Panel de Administración</h1>
        <p className="text-muted-foreground">Gestión de usuarios.</p>
        <div>
          <Link href="/admin/usuarios">
            <Button>Ver usuarios</Button>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  )
}
