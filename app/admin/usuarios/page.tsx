import { DashboardLayout } from "@/components/dashboard-layout"
import { getAllUsers, requireAdmin } from "@/app/actions/admin"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default async function AdminUsersPage() {
  await requireAdmin()
  const users = await getAllUsers()
  return (
    <DashboardLayout>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Usuarios</h1>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-lg font-semibold">Crear usuario</h2>
          <form action="/api/admin/users/create" method="POST" className="space-y-3">
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
                <form action="/api/admin/users/delete" method="POST">
                  <input type="hidden" name="id" value={String(u.id)} />
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
