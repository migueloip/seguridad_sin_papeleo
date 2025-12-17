import { DashboardLayout } from "@/components/dashboard-layout"
import { isAdminAuthenticated } from "@/app/actions/admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"

export default async function AdminPage({ searchParams }: { searchParams?: Promise<Record<string, string>> }) {
  const authed = await isAdminAuthenticated()
  const sp = (await searchParams) || {}
  const error = sp.error

  return (
    <DashboardLayout>
      {authed ? (
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">Panel de Administración</h1>
          <p className="text-muted-foreground">Gestión de usuarios.</p>
          <div>
            <Link href="/admin/usuarios">
              <Button>Ver usuarios</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-sm rounded-lg border border-border bg-card p-6">
          <h1 className="mb-4 text-xl font-semibold">Acceso Administrador</h1>
          {error === "invalid" && <p className="mb-2 text-sm text-destructive">Contraseña inválida</p>}
          {error === "not_configured" && (
            <p className="mb-2 text-sm text-destructive">ADMIN_PASSWORD_HASH o ADMIN_PASSWORD no configurados</p>
          )}
          <form action="/api/admin/login" method="POST" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            <Button type="submit" className="w-full">Entrar</Button>
          </form>
        </div>
      )}
    </DashboardLayout>
  )
}
