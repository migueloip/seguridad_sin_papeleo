"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Command } from "cmdk"
import {
  AlertTriangle,
  Building2,
  FileBarChart,
  FileText,
  Loader2,
  Search,
  Users,
} from "lucide-react"
import { globalSearch, type SearchResult, type SearchResultType } from "@/app/actions/search"

const GROUPS: { type: SearchResultType; label: string; icon: typeof Search }[] = [
  { type: "project", label: "Proyectos", icon: Building2 },
  { type: "finding", label: "Hallazgos", icon: AlertTriangle },
  { type: "document", label: "Documentos", icon: FileText },
  { type: "worker", label: "Personal", icon: Users },
  { type: "report", label: "Informes", icon: FileBarChart },
]

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef(0)

  // Atajo global Ctrl/⌘+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Búsqueda con debounce; seq evita aplicar respuestas fuera de orden
  useEffect(() => {
    if (!open) return
    if (timerRef.current) clearTimeout(timerRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const seq = ++seqRef.current
    timerRef.current = setTimeout(() => {
      globalSearch(q)
        .then((r) => {
          if (seqRef.current === seq) setResults(r)
        })
        .catch(() => {
          if (seqRef.current === seq) setResults([])
        })
        .finally(() => {
          if (seqRef.current === seq) setIsSearching(false)
        })
    }, 250)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, open])

  const close = useCallback(() => {
    setOpen(false)
    setQuery("")
    setResults([])
  }, [])

  const go = (href: string) => {
    close()
    router.push(href)
  }

  return (
    <>
      {/* Trigger con aspecto de input */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-10 w-[260px] items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-muted-foreground transition-colors hover:border-brand/50 md:flex"
        aria-label="Buscar (Ctrl+K)"
      >
        <Search className="h-[17px] w-[17px]" />
        <span className="flex-1 text-left text-sm">Buscar en el proyecto…</span>
        <kbd className="rounded-md border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
          Ctrl K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-border bg-card text-foreground/70 transition-colors hover:bg-secondary md:hidden"
        aria-label="Buscar"
      >
        <Search className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-[rgba(10,8,5,0.45)] p-4 pt-[12vh] backdrop-blur-[2px]"
          onClick={close}
          onKeyDown={(e) => {
            if (e.key === "Escape") close()
          }}
        >
          <div
            className="w-full max-w-[580px] overflow-hidden rounded-[18px] border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Command shouldFilter={false} label="Búsqueda global">
              <div className="flex items-center gap-2.5 border-b border-border px-4">
                {isSearching ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin text-brand" />
                ) : (
                  <Search className="h-[18px] w-[18px] text-muted-foreground" />
                )}
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Busca hallazgos, documentos, personas, informes…"
                  className="h-[52px] flex-1 border-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                />
                <kbd className="rounded-md border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                  Esc
                </kbd>
              </div>

              <Command.List className="max-h-[400px] overflow-y-auto p-2">
                {query.trim().length < 2 ? (
                  <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Escribe al menos 2 caracteres para buscar en todos tus proyectos.
                  </div>
                ) : (
                  <>
                    {!isSearching && results.length === 0 && (
                      <Command.Empty className="px-3 py-10 text-center text-sm text-muted-foreground">
                        Sin resultados para “{query.trim()}”.
                      </Command.Empty>
                    )}
                    {GROUPS.map(({ type, label, icon: Icon }) => {
                      const items = results.filter((r) => r.type === type)
                      if (items.length === 0) return null
                      return (
                        <Command.Group
                          key={type}
                          heading={label}
                          className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground"
                        >
                          {items.map((r) => (
                            <Command.Item
                              key={`${r.type}-${r.id}`}
                              value={`${r.type}-${r.id}`}
                              onSelect={() => go(r.href)}
                              className="flex cursor-pointer items-center gap-3 rounded-[11px] px-3 py-2.5 data-[selected=true]:bg-secondary"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-primary text-brand">
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-foreground">
                                  {r.title}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {r.subtitle}
                                </span>
                              </span>
                            </Command.Item>
                          ))}
                        </Command.Group>
                      )
                    })}
                  </>
                )}
              </Command.List>

              <div className="flex items-center gap-3 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
                <span>
                  <kbd className="rounded border border-border bg-secondary px-1 font-mono">↑↓</kbd>{" "}
                  navegar
                </span>
                <span>
                  <kbd className="rounded border border-border bg-secondary px-1 font-mono">↵</kbd>{" "}
                  abrir
                </span>
                <span>
                  <kbd className="rounded border border-border bg-secondary px-1 font-mono">esc</kbd>{" "}
                  cerrar
                </span>
              </div>
            </Command>
          </div>
        </div>
      )}
    </>
  )
}
