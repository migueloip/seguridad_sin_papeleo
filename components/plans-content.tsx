"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Plus, Check, Building2, Sparkles, ScanLine } from "lucide-react"
import {
  extractZonesFromPlan,
  savePlanFloorsAndZones,
  createPlan,
  getPlans,
} from "@/app/actions/plans"

// ---- tipos locales ----
type Zone = {
  name: string
  level: "Alto" | "Medio" | "Bajo"
  cause: string
  x: number
  y: number
  width: number
  height: number
}
type Floor = { id: string; label: string; zones: Zone[] }
type Building = { id: number; name: string; sub: string; floors: Floor[] }

type PlanRow = {
  id: number
  name: string
  plan_type?: string | null
  file_url?: string | null
  extracted?: unknown
}

interface PlansContentProps {
  plans?: PlanRow[]
  projects?: { id: number; name: string }[]
}

const LEVEL = {
  Alto: { color: "var(--danger)", tint: "var(--danger-tint)" },
  Medio: { color: "var(--warning)", tint: "var(--warning-tint)" },
  Bajo: { color: "var(--success)", tint: "var(--success-tint)" },
} as const

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function normalizeLevel(raw: unknown): Zone["level"] {
  const s = String(raw || "").toLowerCase()
  if (/alto|crit|high/.test(s)) return "Alto"
  if (/bajo|low/.test(s)) return "Bajo"
  return "Medio"
}

function normalizeZone(z: Record<string, unknown>): Zone {
  return {
    name: typeof z.name === "string" ? z.name : "Zona",
    level: normalizeLevel(z.code ?? z.level),
    cause: typeof z.cause === "string" ? z.cause : typeof z.code === "string" ? z.code : "Riesgo detectado",
    x: num(z.x),
    y: num(z.y),
    width: num(z.width) || 0.12,
    height: num(z.height) || 0.12,
  }
}

function buildingFromPlan(p: PlanRow): Building {
  const extracted = p.extracted as { floors?: unknown } | null
  const floorsRaw = Array.isArray(extracted?.floors) ? (extracted!.floors as unknown[]) : []
  const floors: Floor[] = floorsRaw.length
    ? floorsRaw.map((f, i) => {
        const fo = (f || {}) as Record<string, unknown>
        const zonesRaw = Array.isArray(fo.zones) ? (fo.zones as unknown[]) : []
        return {
          id: `f${i}`,
          label: typeof fo.name === "string" ? fo.name : `Piso ${i + 1}`,
          zones: zonesRaw.map((z) => normalizeZone((z || {}) as Record<string, unknown>)),
        }
      })
    : [{ id: "f0", label: "Plano general", zones: [] }]
  return { id: p.id, name: p.name, sub: p.plan_type || "Plano", floors }
}

const SCAN_STEPS = [
  "Cargando plano…",
  "Detectando muros y recintos…",
  "Identificando zonas de trabajo…",
  "Clasificando niveles de riesgo…",
  "Generando mapa de calor…",
]

export function PlansContent({ plans, projects }: PlansContentProps) {
  const [buildings, setBuildings] = useState<Building[]>(() => (plans || []).map(buildingFromPlan))
  const [selIdx, setSelIdx] = useState(0)
  const [selFloorId, setSelFloorId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanStep, setScanStep] = useState("")
  const [, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const addingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Carga planos del proyecto cuando la ruta es /proyectos/[id]/planos (recibe projects, no plans).
  useEffect(() => {
    if ((plans && plans.length) || !projects?.[0]?.id) return
    let active = true
    ;(async () => {
      try {
        const rows = (await getPlans(projects[0].id)) as unknown as PlanRow[]
        if (active) setBuildings((rows || []).map(buildingFromPlan))
      } catch {}
    })()
    return () => {
      active = false
    }
  }, [plans, projects])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const cur = buildings[selIdx]
  const curFloor = cur ? cur.floors.find((f) => f.id === selFloorId) || cur.floors[0] : undefined
  const scanned = !!curFloor && curFloor.zones.length > 0
  const scannedCount = cur ? cur.floors.filter((f) => f.zones.length > 0).length : 0

  const pickFile = (adding: boolean) => {
    addingRef.current = adding
    fileRef.current?.click()
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    const mime = file.type || "image/png"
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String((r.result as string).split(",")[1] || ""))
      r.onerror = reject
      r.readAsDataURL(file)
    })

    if (addingRef.current) {
      // Nuevo edificio: crear plano y escanearlo.
      try {
        const created = (await createPlan({
          name: file.name.replace(/\.[^.]+$/, "") || "Nuevo plano",
          plan_type: "Plano",
          file_name: file.name,
          mime_type: mime,
        })) as unknown as PlanRow
        const nb = buildingFromPlan(created)
        setBuildings((prev) => [...prev, nb])
        const idx = buildings.length
        setSelIdx(idx)
        setSelFloorId(nb.floors[0].id)
        await runScan(base64, mime, idx, nb.floors[0].id, created.id)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo crear el plano")
      }
    } else if (cur && curFloor) {
      await runScan(base64, mime, selIdx, curFloor.id, cur.id)
    }
  }

  async function runScan(
    base64: string,
    mime: string,
    bIdx: number,
    floorId: string,
    planId: number,
  ) {
    setScanning(true)
    setScanProgress(0)
    setScanStep(SCAN_STEPS[0])
    if (timerRef.current) clearInterval(timerRef.current)
    let p = 0
    timerRef.current = setInterval(() => {
      p = Math.min(94, p + 3 + Math.random() * 5)
      setScanProgress(Math.round(p))
      setScanStep(SCAN_STEPS[Math.min(SCAN_STEPS.length - 1, Math.floor(p / 20))])
    }, 160)

    try {
      const result = (await extractZonesFromPlan(base64, mime)) as { floors?: unknown[] }
      const floorsRaw = Array.isArray(result?.floors) ? result.floors : []
      const zones: Zone[] = floorsRaw
        .flatMap((f) => {
          const fo = (f || {}) as Record<string, unknown>
          return Array.isArray(fo.zones) ? (fo.zones as unknown[]) : []
        })
        .map((z) => normalizeZone((z || {}) as Record<string, unknown>))

      if (timerRef.current) clearInterval(timerRef.current)
      setScanProgress(100)
      setScanStep("Análisis completado")

      setBuildings((prev) => {
        const next = prev.map((b) => ({ ...b, floors: b.floors.map((f) => ({ ...f })) }))
        const b = next[bIdx]
        if (b) {
          const fl = b.floors.find((f) => f.id === floorId) || b.floors[0]
          if (fl) fl.zones = zones
        }
        return next
      })

      // Persistir zonas (coords quedan en extracted).
      startTransition(async () => {
        try {
          const b = buildings[bIdx]
          const floorsToSave = (b ? b.floors : []).map((f) => ({
            name: f.label,
            zones: (f.id === floorId ? zones : f.zones).map((z) => ({
              name: z.name,
              code: z.level,
              type: "risk",
              x: z.x,
              y: z.y,
              width: z.width,
              height: z.height,
            })),
          }))
          if (!floorsToSave.length) floorsToSave.push({ name: "Plano general", zones: zones.map((z) => ({ name: z.name, code: z.level, type: "risk", x: z.x, y: z.y, width: z.width, height: z.height })) })
          await savePlanFloorsAndZones(planId, floorsToSave)
        } catch {}
      })

      if (zones.length === 0) toast.info("La IA no detectó zonas de riesgo en este plano.")
      else toast.success(`${zones.length} zona(s) de riesgo detectada(s)`)
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current)
      toast.error(err instanceof Error ? err.message : "Error al escanear el plano con IA")
    } finally {
      setTimeout(() => setScanning(false), 450)
    }
  }

  return (
    <div className="space-y-[18px]">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">
            Planos · Mapa de riesgos
          </h1>
          <p className="text-sm text-muted-foreground">
            Escanea cada plano con IA y visualiza las zonas de riesgo detectadas
          </p>
        </div>
      </div>

      {/* Selector de edificios / planos */}
      <div className="flex flex-wrap gap-2.5">
        {buildings.map((b, i) => {
          const sel = i === selIdx
          return (
            <button
              key={b.id}
              onClick={() => {
                setSelIdx(i)
                setSelFloorId(b.floors[0]?.id ?? null)
              }}
              className={`flex min-w-[150px] flex-col gap-0.5 rounded-xl border px-4 py-2.5 text-left transition-colors ${
                sel ? "border-primary bg-primary text-sidebar-foreground" : "border-border bg-card text-foreground"
              }`}
            >
              <span className="font-display text-[15px] font-semibold">{b.name}</span>
              <span className={`text-xs ${sel ? "text-sidebar-foreground/55" : "text-muted-foreground"}`}>
                {b.sub}
              </span>
            </button>
          )
        })}
        <button
          onClick={() => pickFile(true)}
          className="flex min-w-[90px] flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-border px-4 text-muted-foreground transition-colors hover:border-brand hover:text-[#b8841a]"
        >
          <Plus className="h-5 w-5" />
          <span className="text-xs font-semibold">Plano</span>
        </button>
      </div>

      {!cur ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card p-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <Building2 className="h-7 w-7 text-muted-foreground" />
          </span>
          <div>
            <div className="font-display text-[17px] font-semibold">No hay planos todavía</div>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Sube un plano y la IA detectará automáticamente las zonas de riesgo.
            </p>
          </div>
          <button
            onClick={() => pickFile(true)}
            className="flex h-[42px] items-center gap-2 rounded-[11px] bg-primary px-[18px] text-sm font-semibold text-white hover:bg-[#241f17]"
          >
            <Plus className="h-4 w-4 text-brand" />
            Subir plano
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          {/* Lista de pisos */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-[15px] font-semibold">Pisos</span>
              <span className="rounded-md bg-success-tint px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
                {scannedCount}/{cur.floors.length} escaneados
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              {cur.floors.map((f) => {
                const done = f.zones.length > 0
                const sel = f.id === curFloor?.id
                return (
                  <button
                    key={f.id}
                    onClick={() => setSelFloorId(f.id)}
                    className={`flex items-center gap-3 rounded-xl border-[1.5px] px-3.5 py-3 text-left transition-colors ${
                      sel ? "border-brand bg-[#fffdf7]" : "border-border bg-card"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: done ? "var(--success)" : "var(--border)" }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{f.label}</span>
                      <span
                        className="block text-xs"
                        style={{ color: done ? "var(--muted-foreground)" : "var(--warning)" }}
                      >
                        {done ? `${f.zones.length} zonas detectadas` : "Sin escanear"}
                      </span>
                    </span>
                    {done && <Check className="h-4 w-4 shrink-0 text-[var(--success)]" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Visor + escaneo */}
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
              <div>
                <div className="font-display text-[17px] font-semibold">
                  {cur.name} · {curFloor?.label}
                </div>
                <div className="text-sm text-muted-foreground">
                  {scanned ? `${curFloor?.zones.length} zonas de riesgo` : "Pendiente de escaneo"}
                </div>
              </div>
              <button
                onClick={() => pickFile(false)}
                disabled={scanning}
                className="flex h-10 items-center gap-2 rounded-[11px] bg-primary px-4 text-[13px] font-semibold text-white hover:bg-[#241f17] disabled:opacity-60"
              >
                <ScanLine className="h-4 w-4 text-brand" />
                Escanear piso con IA
              </button>
            </div>

            {/* Lienzo */}
            <div className="relative min-h-[440px] overflow-hidden rounded-2xl border border-border bg-[#16130e]">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(243,164,10,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(243,164,10,.08) 1px,transparent 1px)",
                  backgroundSize: "38px 38px",
                }}
              />
              <svg viewBox="0 0 600 440" className="absolute inset-0 h-full w-full">
                <rect x="40" y="40" width="520" height="360" fill="none" stroke="rgba(246,244,238,.32)" strokeWidth="2" />
                <line x1="300" y1="40" x2="300" y2="240" stroke="rgba(246,244,238,.18)" strokeWidth="2" />
                <line x1="40" y1="240" x2="560" y2="240" stroke="rgba(246,244,238,.18)" strokeWidth="2" />
                <line x1="180" y1="240" x2="180" y2="400" stroke="rgba(246,244,238,.18)" strokeWidth="2" />
                <line x1="420" y1="240" x2="420" y2="400" stroke="rgba(246,244,238,.18)" strokeWidth="2" />
              </svg>

              {/* Pines de calor */}
              {scanned &&
                !scanning &&
                curFloor!.zones.map((z, i) => {
                  const cx = (z.x + z.width / 2) * 100
                  const cy = (z.y + z.height / 2) * 100
                  const col = LEVEL[z.level].color
                  return (
                    <div
                      key={i}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${cx}%`, top: `${cy}%` }}
                      title={`${z.name} · ${z.level}`}
                    >
                      {z.level !== "Bajo" && (
                        <span
                          className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full"
                          style={{ background: col, opacity: 0.25 }}
                        />
                      )}
                      <span
                        className="relative block h-[26px] w-[26px] rounded-full border-2 border-[#16130e]"
                        style={{ background: col }}
                      />
                    </div>
                  )
                })}

              {/* Leyenda */}
              {scanned && !scanning && (
                <div className="absolute bottom-3.5 left-3.5 flex gap-3.5 rounded-[11px] bg-[rgba(22,19,14,.85)] px-3.5 py-2.5">
                  {(["Alto", "Medio", "Bajo"] as const).map((l) => (
                    <span key={l} className="flex items-center gap-1.5 text-xs text-[#f6f4ee]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL[l].color }} />
                      {l}
                    </span>
                  ))}
                </div>
              )}

              {/* Estado vacío */}
              {!scanned && !scanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3.5 p-6 text-center">
                  <span className="flex h-[58px] w-[58px] items-center justify-center rounded-2xl border border-white/10 bg-[#1f1b14]">
                    <ScanLine className="h-7 w-7 text-brand" />
                  </span>
                  <div>
                    <div className="font-display text-[17px] font-semibold text-[#f6f4ee]">
                      Este piso aún no ha sido escaneado
                    </div>
                    <div className="mx-auto mt-1 max-w-[300px] text-sm leading-relaxed text-[#f6f4ee]/55">
                      La IA analizará el plano y detectará automáticamente las zonas de riesgo.
                    </div>
                  </div>
                  <button
                    onClick={() => pickFile(false)}
                    className="flex h-[42px] items-center gap-2 rounded-[11px] bg-brand px-[18px] text-sm font-bold text-brand-foreground"
                  >
                    <Sparkles className="h-4 w-4" />
                    Escanear con IA
                  </button>
                </div>
              )}

              {/* Overlay escaneando */}
              {scanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-[18px] bg-[rgba(22,19,14,.82)] p-8 backdrop-blur-[2px]">
                  <div
                    className="absolute left-0 right-0 h-[3px] animate-[ez-scanline_1.7s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent,#f3a40a,transparent)]"
                    style={{ boxShadow: "0 0 18px 3px rgba(243,164,10,.6)" }}
                  />
                  <div className="h-[54px] w-[54px] animate-spin rounded-full border-[3px] border-brand/25 border-t-brand" />
                  <div className="text-center">
                    <div className="font-display text-[18px] font-semibold text-[#f6f4ee]">
                      Escaneando con IA · {scanProgress}%
                    </div>
                    <div className="mt-1 text-sm text-brand">{scanStep}</div>
                  </div>
                  <div className="h-[7px] w-[260px] overflow-hidden rounded-md bg-[#2e2920]">
                    <div className="h-full rounded-md bg-brand transition-all" style={{ width: `${scanProgress}%` }} />
                  </div>
                </div>
              )}
            </div>

            {/* Zonas detectadas */}
            {scanned && !scanning && (
              <>
                <div className="my-4 flex items-center gap-2 font-display text-[15px] font-semibold">
                  <Sparkles className="h-4 w-4 text-brand" />
                  Zonas detectadas por IA
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {curFloor!.zones.map((z, i) => (
                    <div key={i} className="rounded-[13px] border border-border bg-card p-3.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-semibold">{z.name}</span>
                        <span
                          className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
                          style={{ color: LEVEL[z.level].color, background: LEVEL[z.level].tint }}
                        >
                          {z.level}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <span
                          className="h-[7px] w-[7px] rounded-full"
                          style={{ background: LEVEL[z.level].color }}
                        />
                        {z.cause}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
