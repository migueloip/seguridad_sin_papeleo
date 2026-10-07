"use client"

import type React from "react"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { getProjectById } from "@/app/actions/projects"
import { projectCode } from "@/components/easysecure/sections"

const SidebarClient = dynamic(() => import("./sidebar").then((m) => m.Sidebar), { ssr: false })
const HeaderClient = dynamic(() => import("./header").then((m) => m.Header), { ssr: false })
const AiAssistantDrawer = dynamic(
  () => import("./easysecure/ai-assistant-drawer").then((m) => m.AiAssistantDrawer),
  { ssr: false },
)

interface DashboardLayoutProps {
  children: React.ReactNode
  user?: { email: string; name?: string | null; role?: string | null }
  project?: { id: number; name: string; code?: string | null }
  openFindings?: number
}

export function DashboardLayout({ children, user, project, openFindings }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [curProject, setCurProject] = useState<DashboardLayoutProps["project"]>(project)
  const pathname = usePathname()
  const showSidebar = !pathname.startsWith("/admin") && !pathname.startsWith("/auth")
  // El asistente general responde con los datos propios de quien pregunta (hallazgos con su
  // user_id) y no conoce la obra: dentro de /obra/<id> respondería sin los datos de la obra
  // (o con los de todas las del dueño), así que ahí no se ofrece. La IA de la obra está en sus
  // hallazgos y planos (sugerencias con aprobación humana).
  const assistantAvailable = !/^\/obra\/\d+(?:\/|$)/.test(pathname)

  // En rutas /proyectos/[id]/* carga el proyecto activo para mostrar su nombre y código.
  useEffect(() => {
    const m = pathname.match(/^\/proyectos\/(\d+)/)
    if (!m) {
      setCurProject(project)
      return
    }
    let active = true
    ;(async () => {
      try {
        const r = (await getProjectById(Number(m[1]))) as
          | { id: number; name: string; start_date?: string | null }
          | undefined
        if (active && r) {
          setCurProject({
            id: Number(r.id),
            name: r.name,
            code: projectCode({ id: Number(r.id), start_date: r.start_date }),
          })
        }
      } catch {}
    })()
    return () => {
      active = false
    }
  }, [pathname, project])

  if (!showSidebar) {
    return <div className="min-h-screen bg-background">{children}</div>
  }

  return (
    <div className="flex min-h-screen bg-background">
      <SidebarClient
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenAI={() => setAiOpen(true)}
        user={user}
        project={curProject}
        openFindings={openFindings}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <HeaderClient
          onMenuClick={() => setSidebarOpen(true)}
          onOpenAI={assistantAvailable ? () => setAiOpen(true) : undefined}
          user={user}
          project={curProject}
        />
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
      {assistantAvailable ? <AiAssistantDrawer open={aiOpen} onClose={() => setAiOpen(false)} /> : null}
    </div>
  )
}
