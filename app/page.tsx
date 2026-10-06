import { DashboardContent, type ObraMembershipLink } from "@/components/dashboard-content"
import { DashboardLayout } from "@/components/dashboard-layout"
import { getSession } from "@/lib/auth"
import { getDashboardStats } from "@/app/actions/dashboard"
import { AnimatedPage } from "@/components/animated-page"
import { Landing } from "@/components/easysecure/landing"
import { listProjectAccessForUser } from "@/lib/obra/access"

// Next.js detecta automáticamente que la página es dinámica al usar cookies()
// vía getSession(); el `force-dynamic` explícito es redundante.

export const metadata = {
  title: "Easysecure — Prevención de riesgos, sin papeleo",
  description:
    "Hallazgos, documentación, planos y cumplimiento de cada obra en un solo lugar. Asistido por IA, listo para terreno.",
}

export default async function Home() {
  const session = await getSession()
  // Sin sesión: landing pública. Con sesión: panel principal.
  if (!session) return <Landing />

  const stats = await getDashboardStats()

  // Obras de otros dueños donde la persona es integrante (jefe, trabajador, visita...): el
  // panel heredado muestra solo datos propios, así que se le ofrece entrar directo a su obra.
  let obraMemberships: ObraMembershipLink[] = []
  try {
    obraMemberships = (await listProjectAccessForUser(Number(session.user_id)))
      .filter((a) => !a.is_owner)
      .map((a) => ({ project_id: a.project_id, project_name: a.project_name, role: a.role }))
  } catch (e) {
    console.error("[inicio] no se pudieron leer las obras del usuario", e)
  }

  // Construct user object matching DashboardLayout expectation
  const layoutUser = {
    name: session.name,
    email: session.email,
    role: session.role
  }

  const openFindings = stats.findings.open + stats.findings.in_progress

  return (
    <AnimatedPage duration={400}>
      <DashboardLayout user={layoutUser} openFindings={openFindings}>
        <DashboardContent
          stats={stats}
          userName={session.name || session.email.split("@")[0]}
          obraMemberships={obraMemberships}
        />
      </DashboardLayout>
    </AnimatedPage>
  )
}
