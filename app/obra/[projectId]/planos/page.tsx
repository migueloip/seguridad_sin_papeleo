import { notFound, redirect } from "next/navigation"
import { getObraAccess } from "@/app/actions/obra/projects"
import { countObraPendingApprovals } from "@/app/actions/obra/suggestions"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ObraNav } from "@/components/obra/obra-nav"
import { PlanWorkspace } from "@/components/obra/plan-workspace"
import { getSession } from "@/lib/auth"
import { todayISO } from "@/lib/obra/metrics"
import { can } from "@/lib/obra/permissions"
import { isSupabaseStorageEnabled } from "@/lib/obra/server/storage"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Planos de la obra" }

type SearchParams = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function idParam(v: string | string[] | undefined): number | null {
  const s = first(v)
  return s ? parseIntId(s) : null
}

/**
 * Planos de la obra: visor multi-capa con hallazgos, su contexto y las
 * sugerencias. Parámetros: ?reportar=1, ?finding=<id>, ?task=<id>, ?layer=<id>.
 */
export default async function ObraPlanosPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) redirect("/auth/login")
  const p = await params
  const id = parseIntId(p.projectId)
  if (id === null) notFound()
  const acc = await getObraAccess(id)
  if (!acc.ok) notFound()
  if (!can(acc.data.role, "plans.view") || !acc.data.permissions.includes("plans.view")) notFound()

  const sp = await searchParams
  const reportar = first(sp.reportar)
  const pending = await countObraPendingApprovals(id)
  const pendingApprovals = pending.ok ? pending.data : 0

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ObraNav
        projectId={id}
        projectName={acc.data.project_name}
        role={acc.data.role}
        pendingApprovals={pendingApprovals}
      />
      <PlanWorkspace
        projectId={id}
        role={acc.data.role}
        currentUserId={acc.data.user_id}
        permissions={acc.data.permissions}
        today={todayISO()}
        initialReport={reportar === "1" || reportar === "true"}
        initialFindingId={idParam(sp.finding)}
        initialTaskId={idParam(sp.task)}
        initialLayerId={idParam(sp.layer)}
        directUpload={isSupabaseStorageEnabled()}
      />
    </DashboardLayout>
  )
}
