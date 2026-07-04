"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutGrid,
  TriangleAlert,
  Sparkles,
  FileText,
  BarChart3,
  Users,
  Layers,
  ClipboardCheck,
  Settings,
  ShieldCheck,
  Building2,
  ChevronsUpDown,
  LogOut,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { logout } from "@/app/actions/auth"
import { getSetting } from "@/app/actions/settings"
import { BrandMark } from "@/components/easysecure/brand-mark"
import { projectBase, sectionFromPath, type SectionKey } from "@/components/easysecure/sections"

interface SidebarComponentProps {
  open: boolean
  onClose: () => void
  onOpenAI?: () => void
  user?: { email: string; name?: string | null; role?: string | null }
  project?: { id: number; name: string; code?: string | null }
  openFindings?: number
  /** Secciones habilitadas (toggles de Configuración). Por defecto todas. */
  enabled?: Partial<Record<SectionKey, boolean>>
}

type NavItem = {
  key: SectionKey
  name: string
  icon: LucideIcon
  href?: string
  badge?: number
  chip?: string
  action?: "ai"
}

export function Sidebar({
  open,
  onClose,
  onOpenAI,
  user,
  project,
  openFindings = 0,
  enabled,
}: SidebarComponentProps) {
  const pathname = usePathname()
  const base = projectBase(pathname)
  const active = sectionFromPath(pathname)
  const [navDisabled, setNavDisabled] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    getSetting("nav_disabled")
      .then((v) => {
        try {
          const arr = JSON.parse(v || "[]")
          if (alive && Array.isArray(arr)) setNavDisabled(arr.map(String))
        } catch {}
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const on = (k: SectionKey) => enabled?.[k] !== false && !navDisabled.includes(k)

  const items: NavItem[] = [
    { key: "dashboard", name: "Principal", icon: LayoutGrid, href: "/" },
    { key: "hallazgos", name: "Hallazgos", icon: TriangleAlert, href: `${base}/hallazgos`, badge: openFindings },
    { key: "ia", name: "IA", icon: Sparkles, href: "/ia", chip: "CHAT" },
    { key: "documentos", name: "Documentos", icon: FileText, href: `${base}/documentos` },
    { key: "informes", name: "Informes", icon: BarChart3, href: `${base}/informes` },
    { key: "personal", name: "Personal", icon: Users, href: `${base}/personal` },
    { key: "planos", name: "Planos · Riesgos", icon: Layers, href: `${base}/planos` },
    { key: "checklists", name: "Checklists", icon: ClipboardCheck, href: "/checklists" },
  ].filter((it) => it.key === "dashboard" || it.key === "ia" || on(it.key as SectionKey))

  const renderNav = (it: NavItem) => {
    const isActive = active === it.key
    const cls = cn(
      "group relative my-0.5 flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors",
      isActive
        ? "bg-sidebar-accent text-sidebar-foreground shadow-[inset_3px_0_0_var(--color-sidebar-primary)]"
        : "text-sidebar-foreground/60 hover:bg-white/[0.05] hover:text-sidebar-foreground",
    )
    const inner = (
      <>
        <it.icon className={cn("h-[19px] w-[19px]", it.key === "ia" && "text-brand")} />
        <span className="flex-1">{it.name}</span>
        {it.badge ? (
          <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">
            {it.badge}
          </span>
        ) : null}
        {it.chip ? (
          <span className="rounded-md bg-brand px-[7px] py-0.5 text-[10px] font-bold tracking-wide text-brand-foreground">
            {it.chip}
          </span>
        ) : null}
      </>
    )
    if (it.action === "ai") {
      return (
        <button
          key={it.key}
          type="button"
          onClick={() => {
            onOpenAI?.()
            onClose()
          }}
          className={cn(cls, "w-full text-left")}
        >
          {inner}
        </button>
      )
    }
    return (
      <Link key={it.key} href={it.href || "/"} onClick={onClose} className={cls}>
        {inner}
      </Link>
    )
  }

  const isAdmin = user?.role === "admin"

  return (
    <>
      {/* Backdrop móvil */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen w-[260px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 ease-in-out",
          "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-[248px] lg:translate-x-0 lg:shrink-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-[18px]">
          <BrandMark size={34} />
          <span className="font-display text-[18px] font-bold tracking-tight">Easysecure</span>
          <button
            className="ml-auto rounded-md p-1 text-sidebar-foreground/60 hover:bg-white/5 lg:hidden"
            onClick={onClose}
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Selector de proyecto */}
        <Link
          href="/proyectos"
          onClick={onClose}
          className="mx-3 mb-1.5 mt-3.5 flex items-center gap-2.5 rounded-[11px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition-colors hover:border-white/20"
        >
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
            <Building2 className="h-4 w-4 text-brand" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-sidebar-foreground">
              {project?.name || "Selecciona proyecto"}
            </span>
            <span className="block text-[11px] text-sidebar-foreground/45">Cambiar proyecto</span>
          </span>
          <ChevronsUpDown className="h-[15px] w-[15px] text-sidebar-foreground/50" />
        </Link>

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto px-3 py-2.5">
          <div className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/35">
            Proyecto
          </div>
          {items.map(renderNav)}

          <div className="px-3 pb-1.5 pt-[18px] text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/35">
            Sistema
          </div>
          {isAdmin &&
            renderNav({ key: "admin", name: "Administración", icon: ShieldCheck, href: "/admin" })}
          {renderNav({ key: "config", name: "Configuración", icon: Settings, href: "/configuracion" })}
        </nav>

        {/* Usuario */}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 p-1.5">
            <Link
              href="/perfil"
              onClick={onClose}
              title="Editar perfil"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 transition-colors hover:bg-white/[0.05]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[13px] font-semibold text-brand">
                {(user?.name || user?.email || "U").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-sidebar-foreground">
                  {user?.name || user?.email}
                </p>
                <p className="truncate text-[11px] text-sidebar-foreground/45">
                  {user?.role || "usuario"}
                </p>
              </div>
            </Link>
            <form action={logout}>
              <button
                type="submit"
                title="Cerrar sesión"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/55 transition-colors hover:bg-white/[0.06] hover:text-sidebar-foreground"
              >
                <LogOut className="h-[17px] w-[17px]" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  )
}
