"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ClipboardList, Gauge, History, Layers, ShieldCheck, UsersRound, CalendarCheck } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { can, type Permission } from "@/lib/obra/permissions"
import type { ObraRole } from "@/lib/obra/types"
import { RoleBadge } from "./badges"

type Tab = { href: string; label: string; icon: LucideIcon; perm: Permission; badge?: number }

/**
 * Cabecera común de todas las páginas /obra/[projectId]/*: nombre de la obra,
 * rol del usuario y pestañas filtradas por permisos del rol.
 */
export function ObraNav({
  projectId,
  projectName,
  role,
  pendingApprovals = 0,
}: {
  projectId: number
  projectName: string
  role: ObraRole
  pendingApprovals?: number
}) {
  const pathname = usePathname()
  const base = `/obra/${projectId}`
  const tabs: Tab[] = [
    { href: base, label: "Resumen", icon: Gauge, perm: "project.view" },
    { href: `${base}/planos`, label: "Planos", icon: Layers, perm: "plans.view" },
    {
      href: `${base}/aprobaciones`,
      label: "Aprobaciones IA",
      icon: ShieldCheck,
      perm: "findings.view",
      // El contador pide una decisión: solo para quien puede aprobar o descartar.
      badge: can(role, "ai.review") ? pendingApprovals : 0,
    },
    { href: `${base}/tareas`, label: "Tareas", icon: ClipboardList, perm: "project.view" },
    { href: `${base}/revisiones`, label: "Revisiones", icon: CalendarCheck, perm: "project.view" },
    { href: `${base}/equipo`, label: "Equipo", icon: UsersRound, perm: "project.view" },
    { href: `${base}/auditoria`, label: "Auditoría", icon: History, perm: "audit.view" },
  ]
  const visible = tabs.filter((t) => can(role, t.perm))

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/obra" className="text-sm text-muted-foreground hover:text-foreground">
          Obras
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="font-display text-2xl font-bold tracking-tight">{projectName}</h1>
        <RoleBadge role={role} />
      </div>
      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Secciones de la obra">
        {visible.map((t) => {
          const active = t.href === base ? pathname === base : pathname.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
              {t.badge ? (
                <span
                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white"
                  aria-label={`${t.badge} pendiente${t.badge === 1 ? "" : "s"} de aprobación`}
                >
                  {t.badge}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
