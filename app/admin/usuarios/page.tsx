import { DashboardLayout } from "@/components/dashboard-layout"
import { getAllUsers, createUser, deleteUser, adminLogout, isAdminAuthenticated } from "@/app/actions/admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default async function AdminUsersPage() {
  const authed = await isAdminAuthenticated()
  if (!authed) {
    return (
      <DashboardLayout>
        <div className="mx-auto w-full max-w-sm rounded-lg border border-border bg-card p-6">
          <p className="text-muted-foreground">No autorizado</p>
        </div>
      </DashboardLayout>
    )
  }
  const users = await getAllUsers()
  return (
    <DashboardLayout>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Usuarios</h1>
        <form action={adminLogout}>
          <Button variant="outline">Salir</Button>
        </form>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-lg font-semibold">Crear usuario</h2>
          <form action={createUser} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" name="name" type="text" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Rol</Label>
              <Input id="role" name="role" type="text" placeholder="user|admin" />
            </div>
            <Button type="submit">Crear</Button>
          </form>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-lg font-semibold">Listado</h2>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded border p-2">
                <div>
                  <div className="font-medium">{u.email}</div>
                  <div className="text-sm text-muted-foreground">{u.name || "-"}</div>
                  <div className="text-xs text-muted-foreground">rol: {u.role || "user"}</div>
                </div>
                <form action={async () => deleteUser(Number(u.id))}>
                  <Button variant="destructive">Eliminar</Button>
                </form>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
