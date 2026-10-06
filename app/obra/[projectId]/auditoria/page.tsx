import { notFound, redirect } from "next/navigation"
import { Lock, TriangleAlert } from "lucide-react"
import { listObraAudit } from "@/app/actions/obra/audit"
import { getObraAccess } from "@/app/actions/obra/projects"
import { DashboardLayout } from "@/components/dashboard-layout"
import { AuditContent } from "@/components/obra/audit-content"
import { ObraNav } from "@/components/obra/obra-nav"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getSession } from "@/lib/auth"
import { can } from "@/lib/obra/permissions"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Auditoría de la obra" }

/** Entradas por página (se define aquí: las constantes de un módulo "use client" no llegan como valor al servidor). */
const PAGE_SIZE = 50

export default async function ObraAuditoriaPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const p = await params
  const id = parseIntId(p.projectId)
  if (id === null) notFound()
  const acc = await getObraAccess(id)
  if (!acc.ok) notFound()

  const allowed = can(acc.data.role, "audit.view")
  const entries = allowed ? await listObraAudit(id, { limit: PAGE_SIZE }) : null

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ObraNav projectId={id} projectName={acc.data.project_name} role={acc.data.role} />
      {!allowed ? (
        <Alert>
          <Lock />
          <AlertTitle>Tu rol no permite ver la auditoría</AlertTitle>
          <AlertDescription>
            La auditoría la ven el gerente, el jefe de obra, el prevencionista y las visitas (ITO). Si la necesitas, pídelo a
            quien administra el equipo.
          </AlertDescription>
        </Alert>
      ) : entries && entries.ok ? (
        <AuditContent projectId={id} initialEntries={entries.data} pageSize={PAGE_SIZE} />
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No se pudo cargar la auditoría</AlertTitle>
          <AlertDescription>{entries && entries.ok === false ? entries.error : null}</AlertDescription>
        </Alert>
      )}
    </DashboardLayout>
  )
}
