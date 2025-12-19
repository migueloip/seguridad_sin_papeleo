"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { LayoutDashboard, FileText, ClipboardCheck, FileBarChart, AlertTriangle, Users, Settings, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { logout } from "@/app/actions/auth"

function buildNavigation(pathname: string) {
  const m = pathname.match(/^\/proyectos\/(\d+)/)
  const base = m ? `/proyectos/${m[1]}` : ""
  return [
    { name: "Dashboard", href: base || "/", icon: LayoutDashboard },
    { name: "Documentos", href: `${base}/documentos`, icon: FileText },
    { name: "Checklists", href: `${base}/checklists`, icon: ClipboardCheck },
    { name: "Informes", href: `${base}/informes`, icon: FileBarChart },
    { name: "Hallazgos", href: `${base}/hallazgos`, icon: AlertTriangle },
    { name: "Personal", href: `${base}/personal`, icon: Users },
  ]
}

const secondaryNavigation = [{ name: "Configuración", href: "/configuracion", icon: Settings }]

interface SidebarComponentProps {
  open: boolean
  onClose: () => void
  user?: { email: string; name?: string | null; role?: string | null }
}

export function Sidebar({ open, onClose, user }: SidebarComponentProps) {
  const pathname = usePathname()
  const [companyName, setCompanyName] = useState<string | null>(null)
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch("/api/settings/company-name", { cache: "no-store" })
        const data = await res.json()
        const name = typeof data?.company_name === "string" ? data.company_name : null
        setCompanyName(name)
      } catch {}
    })()
  }, [])
  const secondaryText =
    companyName && companyName.trim().toLowerCase() !== "safework pro" && companyName.trim().length > 0
      ? companyName
      : "La seguridad es lo primero"

  return (
    <>
      {/* Mobile backdrop */}
      {open && <div className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden" onClick={onClose} />}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 transform bg-sidebar transition-transform duration-300 ease-in-out lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between px-6 border-b border-sidebar-border">
            <Link href="/" className="flex items-center gap-3">
              <img src="/logo_safework.png" alt="Logo" className="h-18 w-18 object-contain" />
              <div className="flex flex-col">
                <span className="text-lg font-semibold text-sidebar-foreground">Easysecure</span>
                <span className="text-xs text-sidebar-foreground/60">{secondaryText}</span>
              </div>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            <div className="mb-2">
              <span className="px-3 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
                Principal
              </span>
            </div>
            {buildNavigation(pathname).map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                  onClick={onClose}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              )
            })}

            <div className="mb-2 mt-6">
              <span className="px-3 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
                Sistema
              </span>
            </div>
            {(user?.role === "admin" ? [{ name: "Admin", href: "/admin", icon: Settings }, ...secondaryNavigation] : secondaryNavigation).map((item) => {
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                  onClick={onClose}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              )
            })}
          </nav>

          {/* User info */}
          <div className="border-t border-sidebar-border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sidebar-accent">
                <span className="text-sm font-medium text-sidebar-accent-foreground">
                  {(user?.name || user?.email || "U").slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-sidebar-foreground">{user?.name || user?.email}</p>
                <p className="text-xs text-sidebar-foreground/60">{user?.role || "usuario"}</p>
              </div>
            </div>
            <form action={logout} className="mt-3">
              <Button variant="outline" className="w-full">
                Cerrar sesión
              </Button>
            </form>
          </div>
        </div>
      </aside>
    </>
  )
}
