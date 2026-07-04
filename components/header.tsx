"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bell, Menu, Sparkles, CheckCheck } from "lucide-react"
import { GlobalSearch } from "@/components/easysecure/global-search"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { sectionTitleFromPath } from "@/components/easysecure/sections"
import { getNotifications, markNotificationsRead, type NotificationItem } from "@/app/actions/notifications"

interface HeaderComponentProps {
  onMenuClick: () => void
  onOpenAI?: () => void
  user?: { email: string; name?: string | null; role?: string | null }
  project?: { id: number; name: string; code?: string | null }
}

export function Header({ onMenuClick, onOpenAI, project }: HeaderComponentProps) {
  const pathname = usePathname()
  const title = sectionTitleFromPath(pathname)

  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let alive = true
    getNotifications()
      .then((r) => {
        if (alive) {
          setItems(r.items)
          setUnread(r.unread)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [pathname])

  const markRead = () => {
    setUnread(0)
    markNotificationsRead().catch(() => {})
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-7">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Título de sección */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-muted-foreground">{project?.code || ""}</div>
        <div className="truncate font-display text-base font-semibold tracking-tight">{title}</div>
      </div>

      {/* Buscador global (Ctrl+K) */}
      <GlobalSearch />

      {/* Asistente IA */}
      <button
        type="button"
        onClick={onOpenAI}
        className="flex h-10 items-center gap-2 rounded-[11px] bg-primary px-[15px] text-[13px] font-semibold text-white transition-colors hover:bg-[#241f17]"
      >
        <Sparkles className="h-4 w-4 text-brand" />
        <span className="hidden sm:inline">Asistente IA</span>
      </button>

      {/* Notificaciones */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative flex h-10 w-10 items-center justify-center rounded-[11px] border border-border bg-card text-foreground/70 transition-colors hover:bg-secondary"
            aria-label="Notificaciones"
          >
            <Bell className="h-[18px] w-[18px]" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[340px] p-0">
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="text-sm font-semibold">Notificaciones</span>
            {unread > 0 && (
              <button
                onClick={markRead}
                className="flex items-center gap-1 text-xs font-semibold text-[#b8841a] hover:underline"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar como leídas
              </button>
            )}
          </div>
          <DropdownMenuSeparator className="my-0" />
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No tienes alertas pendientes 🎉
            </div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto py-1">
              {items.map((n) => (
                <DropdownMenuItem key={n.key} asChild className="cursor-pointer px-3 py-2.5">
                  <Link href={n.href} className="flex items-start gap-2.5">
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: n.severity === "danger" ? "var(--danger)" : "var(--warning)" }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{n.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{n.message}</span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
