import { notFound, redirect } from "next/navigation"
import { TriangleAlert } from "lucide-react"
import { listObraInspections } from "@/app/actions/obra/inspections"
import { listObraMembers } from "@/app/actions/obra/members"
import { getObraAccess } from "@/app/actions/obra/projects"
import { listObraTasks } from "@/app/actions/obra/tasks"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ObraNav } from "@/components/obra/obra-nav"
import { TasksBoard, type TasksBoardFilter } from "@/components/obra/tasks-board"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getSession } from "@/lib/auth"
import { todayISO } from "@/lib/obra/metrics"
import { PRIORITIES, type Priority } from "@/lib/obra/types"
import { parseIntId } from "@/lib/route"

export const metadata = { title: "Tareas de la obra" }

type SearchParams = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Filtros iniciales desde la URL: ?mine=1, ?revision=<id>|sin, ?prioridad=<prioridad>. */
function filterFromSearch(sp: SearchParams): TasksBoardFilter {
  const mine = first(sp.mine)
  const revision = first(sp.revision)
  const prioridad = first(sp.prioridad)
  const revisionId = revision ? parseIntId(revision) : null
  return {
    mine: mine === "1" || mine === "true",
    inspection: revision === "sin" || revision === "none" ? "none" : revisionId,
    priority: prioridad && (PRIORITIES as readonly string[]).includes(prioridad) ? (prioridad as Priority) : null,
  }
}

export default async function ObraTareasPage({
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

  const [sp, tasks, members, inspections] = await Promise.all([
    searchParams,
    listObraTasks(id),
    listObraMembers(id),
    listObraInspections(id),
  ])

  const error =
    tasks.ok === false
      ? tasks.error
      : members.ok === false
        ? members.error
        : inspections.ok === false
          ? inspections.error
          : null

  return (
    <DashboardLayout user={{ email: String(session.email), name: session.name ?? null, role: session.role ?? null }}>
      <ObraNav projectId={id} projectName={acc.data.project_name} role={acc.data.role} />
      {tasks.ok && members.ok && inspections.ok ? (
        <TasksBoard
          projectId={id}
          role={acc.data.role}
          currentUserId={acc.data.user_id}
          initialTasks={tasks.data}
          members={members.data}
          inspections={inspections.data}
          initialFilter={filterFromSearch(sp)}
          today={todayISO()}
        />
      ) : (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>No se pudieron cargar las tareas</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </DashboardLayout>
  )
}
