"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  FileText,
  Upload,
  ClipboardCheck,
  FileBarChart,
  AlertTriangle,
  Users,
  Settings,
  HardHat,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Documentos", href: "/documentos", icon: FileText },
  { name: "Subir Archivos", href: "/subir", icon: Upload },
  { name: "Checklists", href: "/checklists", icon: ClipboardCheck },
  { name: "Informes", href: "/informes", icon: FileBarChart },
  { name: "Hallazgos", href: "/hallazgos", icon: AlertTriangle },
  { name: "Personal", href: "/personal", icon: Users },
]

const secondaryNavigation = [{ name: "Configuración", href: "/configuracion", icon: Settings }]

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname()

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
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary">
                <HardHat className="h-5 w-5 text-sidebar-primary-foreground" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-semibold text-sidebar-foreground">SafeWork</span>
                <span className="text-xs text-sidebar-foreground/60">Pro</span>
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
            {navigation.map((item) => {
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
            {secondaryNavigation.map((item) => {
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
                <span className="text-sm font-medium text-sidebar-accent-foreground">JM</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-sidebar-foreground">Juan Martínez</p>
                <p className="text-xs text-sidebar-foreground/60">Prevencionista</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
