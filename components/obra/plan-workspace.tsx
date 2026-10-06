"use client"

/**
 * Espacio de planos de la obra (/obra/[id]/planos): visor multi-capa por
 * nivel con los hallazgos ubicados, su contexto (correlaciones con las redes
 * de las demás capas), las sugerencias con aprobación humana y las
 * herramientas para reportar hallazgos, dibujar elementos y gestionar capas.
 *
 * Carga sus datos con las acciones de app/actions/obra/* (layers, elements,
 * pins). Lee de la URL (vía props del servidor): ?reportar=1 entra en modo
 * reportar, ?finding=<id> selecciona y centra un hallazgo, ?task=<id> muestra
 * la ubicación de una tarea y ?layer=<id> abre el nivel de una capa.
 *
 * En escritorio el panel va a la derecha; en el celular es una hoja inferior.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import {
  ChevronUp,
  Hand,
  Layers,
  Loader2,
  MapPinned,
  MapPinPlus,
  PenLine,
  RotateCw,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react"
import { listObraElements } from "@/app/actions/obra/elements"
import { listObraLayers } from "@/app/actions/obra/layers"
import { listObraPins, listUnpinnedObraFindings, pinExistingObraFinding } from "@/app/actions/obra/pins"
import { listObraTasks } from "@/app/actions/obra/tasks"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { clamp01, toLevelMeters } from "@/lib/obra/geometry"
import { todayISO } from "@/lib/obra/metrics"
import { can } from "@/lib/obra/permissions"
import {
  DISCIPLINE_LABELS,
  FINDING_CATEGORY_LABELS,
  type Discipline,
  type FindingPin,
  type ObraRole,
  type PlanElement,
  type PlanLayer,
  type Severity,
  type Vec2,
} from "@/lib/obra/types"
import { cn } from "@/lib/utils"
import { SeverityBadge } from "./badges"
import { ElementDrawToolbar, newElementDraft, SelectedElementCard, type ElementDraftState } from "./element-tools"
import { FindingContextPanel, FINDING_STATUS_LABELS, useFindingContext } from "./finding-context-panel"
import { LayerFrameDialog } from "./layer-frame-dialog"
import { LayerPanel } from "./layer-panel"
import { LayerUploadDialog } from "./layer-upload-dialog"
import {
  elementColor,
  layerFrameOf,
  levelLabel,
  levelsOf,
  PlanCanvas,
  SEVERITY_COLOR_VARS,
  sortLayersForDrawing,
  type PlanClickInfo,
  type PlanDraft,
  type PlanFocus,
  type PlanMarker,
  type PlanMode,
} from "./plan-canvas"
import { ReportFindingDialog, type ReportFindingResult } from "./report-finding-dialog"
import { callAction, TimeAgo } from "./task-card"

type PanelTab = "capas" | "hallazgos" | "detalle"
type UnpinnedFinding = { id: number; title: string; severity: Severity; status: string; created_at: string }

const EMPTY_LAYERS: PlanLayer[] = []
const EMPTY_ELEMENTS: PlanElement[] = []
const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 }

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const DESKTOP_QUERY = "(min-width: 1024px)"

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}

/** true en pantallas anchas (panel lateral); false en el celular (hoja inferior). */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  )
}

function defaultLevel(layers: PlanLayer[]): number | null {
  const levels = levelsOf(layers)
  if (levels.length === 0) return null
  if (levels.includes(0)) return 0
  return levels.reduce((best, l) => (Math.abs(l) < Math.abs(best) ? l : best), levels[0])
}

/** Capa activa por defecto de un nivel: arquitectura, si no la primera con lámina, si no la primera. */
function defaultActiveLayer(layers: PlanLayer[], level: number | null): number | null {
  if (level == null) return null
  const onLevel = sortLayersForDrawing(layers.filter((l) => l.level === level))
  return (onLevel.find((l) => l.discipline === "arquitectura") ?? onLevel.find((l) => l.has_image) ?? onLevel[0])?.id ?? null
}

/** Mantiene ?finding=<id> en la URL (para compartir o volver) sin recargar la página. */
function syncFindingInUrl(findingId: number | null) {
  if (typeof window === "undefined") return
  try {
    const url = new URL(window.location.href)
    for (const k of ["reportar", "task", "layer"]) url.searchParams.delete(k)
    if (findingId != null) url.searchParams.set("finding", String(findingId))
    else url.searchParams.delete("finding")
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // Si el navegador no permite cambiar la URL, la pantalla sigue funcionando igual.
  }
}

function pinMeters(pin: Pick<FindingPin, "layer_id" | "x" | "y">, layers: PlanLayer[]): Vec2 | null {
  const layer = layers.find((l) => l.id === pin.layer_id)
  return layer ? toLevelMeters({ x: pin.x, y: pin.y }, layerFrameOf(layer)) : null
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export type PlanWorkspaceProps = {
  projectId: number
  role: ObraRole
  currentUserId: number
  /** Permisos del rol (de getObraAccess); si no se entregan, se usan los del rol. */
  permissions?: string[]
  /** Fecha de hoy "YYYY-MM-DD" del servidor. */
  today?: string
  initialReport?: boolean
  initialFindingId?: number | null
  initialTaskId?: number | null
  initialLayerId?: number | null
}

export function PlanWorkspace({
  projectId,
  role,
  currentUserId,
  permissions,
  today: todayProp,
  initialReport = false,
  initialFindingId = null,
  initialTaskId = null,
  initialLayerId = null,
}: PlanWorkspaceProps) {
  const today = todayProp ?? todayISO()
  const isDesktop = useIsDesktop()
  const has = useCallback(
    (p: Parameters<typeof can>[1]) => can(role, p) && (permissions ? permissions.includes(p) : true),
    [role, permissions],
  )
  const canReport = has("findings.report")
  const canManagePlans = has("plans.manage")
  const canViewFindings = has("findings.view")

  // --- Datos ---------------------------------------------------------------------
  const [layers, setLayers] = useState<PlanLayer[] | null>(null)
  const [pins, setPins] = useState<FindingPin[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [elementsByLevel, setElementsByLevel] = useState<Record<number, PlanElement[]>>({})
  const [loadingLevels, setLoadingLevels] = useState<number[]>([])
  const requestedLevels = useRef(new Set<number>())
  const [unpinned, setUnpinned] = useState<UnpinnedFinding[] | null>(null)
  const [unpinnedLoading, setUnpinnedLoading] = useState(false)

  // --- Vista -----------------------------------------------------------------------
  const [level, setLevel] = useState<number | null>(null)
  const [activeLayerId, setActiveLayerId] = useState<number | null>(null)
  const [hiddenLayerIds, setHiddenLayerIds] = useState<number[]>([])
  const [hiddenDisciplines, setHiddenDisciplines] = useState<Discipline[]>([])
  const [opacity, setOpacity] = useState<Record<number, number>>({})
  const [showPins, setShowPins] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [allLevelsFindings, setAllLevelsFindings] = useState(false)
  const [mode, setMode] = useState<PlanMode>("navegar")
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null)
  const [selectedElementId, setSelectedElementId] = useState<number | null>(null)
  const [focus, setFocus] = useState<PlanFocus | null>(null)
  const focusNonce = useRef(0)
  const [taskMarker, setTaskMarker] = useState<PlanMarker | null>(null)
  const [panelTab, setPanelTab] = useState<PanelTab>("capas")
  const [sheetOpen, setSheetOpen] = useState(false)

  // --- Acciones en curso -------------------------------------------------------------
  const [reportPoint, setReportPoint] = useState<{ layerId: number; x: number; y: number } | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [placing, setPlacing] = useState<{ id: number; title: string } | null>(null)
  const [placingBusy, setPlacingBusy] = useState(false)
  const [draft, setDraft] = useState<ElementDraftState | null>(null)
  const [finishSignal, setFinishSignal] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [frameLayerId, setFrameLayerId] = useState<number | null>(null)

  const layersList = layers ?? EMPTY_LAYERS
  const context = useFindingContext(selectedFindingId)

  // --- Carga -------------------------------------------------------------------------

  const reloadLayers = useCallback(async (): Promise<PlanLayer[] | null> => {
    const r = await callAction(() => listObraLayers(projectId))
    if (r.ok === false) {
      toast.error(r.error)
      return null
    }
    setLayers(r.data)
    return r.data
  }, [projectId])

  const reloadPins = useCallback(async () => {
    const r = await callAction(() => listObraPins(projectId))
    if (r.ok === false) {
      toast.error(r.error)
      return
    }
    setPins(r.data)
  }, [projectId])

  const loadLevel = useCallback(
    async (lvl: number, force = false) => {
      if (!force && requestedLevels.current.has(lvl)) return
      requestedLevels.current.add(lvl)
      setLoadingLevels((p) => (p.includes(lvl) ? p : [...p, lvl]))
      const r = await callAction(() => listObraElements(projectId, { level: lvl }))
      setLoadingLevels((p) => p.filter((x) => x !== lvl))
      if (r.ok === false) {
        requestedLevels.current.delete(lvl)
        toast.error(r.error)
        return
      }
      setElementsByLevel((prev) => ({ ...prev, [lvl]: r.data }))
    },
    [projectId],
  )

  const focusOn = useCallback((m: Vec2 | null, span = 30) => {
    if (!m) return
    focusNonce.current += 1
    setFocus({ x: m.x, y: m.y, nonce: focusNonce.current, span_m: span })
  }, [])

  /** Selecciona un hallazgo, abre su detalle y (opcionalmente) centra el plano en él. */
  const openFinding = useCallback(
    (pin: FindingPin, ls: PlanLayer[], center: boolean) => {
      setSelectedFindingId(pin.finding_id)
      setSelectedElementId(null)
      setPanelTab("detalle")
      setSheetOpen(true)
      if (center) focusOn(pinMeters(pin, ls))
      syncFindingInUrl(pin.finding_id)
    },
    [focusOn],
  )

  const init = useCallback(async () => {
    setLoadError(null)
    const [lr, pr] = await Promise.all([
      callAction(() => listObraLayers(projectId)),
      callAction(() => listObraPins(projectId)),
    ])
    if (lr.ok === false) {
      setLoadError(lr.error)
      return
    }
    const ls = lr.data
    const ps = pr.ok ? pr.data : []
    if (pr.ok === false) toast.error(pr.error)
    if (ls.length === 0) {
      setLayers(ls)
      setPins(ps)
      return
    }

    // La tarea de ?task se busca antes de mostrar el plano, para abrirlo ya en su nivel.
    const taskList = initialFindingId == null && initialTaskId != null ? await callAction(() => listObraTasks(projectId)) : null
    setLayers(ls)
    setPins(ps)
    let lvl = defaultLevel(ls)
    let active: number | null = null
    if (initialFindingId != null) {
      const pin = ps.find((p) => p.finding_id === initialFindingId)
      if (pin) {
        lvl = pin.level
        openFinding(pin, ls, true)
      } else {
        toast.error("Ese hallazgo no está ubicado en el plano o no tienes acceso a él.")
      }
    } else if (initialTaskId != null) {
      const task = taskList && taskList.ok ? taskList.data.find((t) => t.id === initialTaskId) : undefined
      const pin = task?.finding_id != null ? ps.find((p) => p.finding_id === task.finding_id) : undefined
      const taskLayer = task?.layer_id != null ? ls.find((l) => l.id === task.layer_id) : undefined
      if (pin) {
        lvl = pin.level
        openFinding(pin, ls, true)
      } else if (task && taskLayer && task.x != null && task.y != null) {
        lvl = taskLayer.level
        active = taskLayer.id
        setTaskMarker({ layerId: taskLayer.id, x: task.x, y: task.y, kind: "task", label: task.title })
        focusOn(toLevelMeters({ x: task.x, y: task.y }, layerFrameOf(taskLayer)))
      } else {
        toast.error("No se encontró la ubicación de esa tarea en el plano.")
      }
    } else if (initialLayerId != null) {
      const layer = ls.find((l) => l.id === initialLayerId)
      if (layer) {
        lvl = layer.level
        active = layer.id
      }
    }
    setLevel(lvl)
    setActiveLayerId(active ?? defaultActiveLayer(ls, lvl))
    if (initialReport && canReport) {
      setMode("reportar")
      setSheetOpen(false)
    }
  }, [projectId, initialFindingId, initialTaskId, initialLayerId, initialReport, canReport, openFinding, focusOn])

  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    void init()
  }, [init])

  useEffect(() => {
    if (level != null && layers && layers.length > 0) void loadLevel(level)
  }, [level, layers, loadLevel])

  // Elementos de los niveles adyacentes que aparecen en las correlaciones del hallazgo.
  const correlations = context.data?.correlations ?? null
  useEffect(() => {
    if (!correlations || !layers) return
    const needed = new Set<number>()
    for (const c of correlations) {
      const l = layers.find((x) => x.id === c.layer_id)
      if (l) needed.add(l.level)
    }
    needed.forEach((lv) => void loadLevel(lv))
  }, [correlations, layers, loadLevel])

  // Escape sale del modo reportar.
  useEffect(() => {
    if (mode !== "reportar" || reportOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return
      // Escape dentro de un menú o diálogo solo cierra ese menú o diálogo.
      if ((e.target as HTMLElement | null)?.closest?.("[role=dialog],[role=listbox],[role=menu]")) return
      setMode("navegar")
      setPlacing(null)
      setReportPoint(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mode, reportOpen])

  // --- Derivados -----------------------------------------------------------------------

  const levels = useMemo(() => levelsOf(layersList), [layersList])
  const levelLayers = useMemo(() => layersList.filter((l) => l.level === level), [layersList, level])
  const visibleLayers = useMemo(
    () => levelLayers.filter((l) => !hiddenLayerIds.includes(l.id) && !hiddenDisciplines.includes(l.discipline)),
    [levelLayers, hiddenLayerIds, hiddenDisciplines],
  )
  const activeLayer = levelLayers.find((l) => l.id === activeLayerId) ?? null
  const levelElements = level != null ? elementsByLevel[level] ?? EMPTY_ELEMENTS : EMPTY_ELEMENTS
  const elementIndex = useMemo(() => {
    const m = new Map<number, PlanElement>()
    for (const list of Object.values(elementsByLevel)) for (const e of list) m.set(e.id, e)
    return m
  }, [elementsByLevel])
  const levelPins = useMemo(() => pins.filter((p) => p.level === level), [pins, level])
  const selectedPin = pins.find((p) => p.finding_id === selectedFindingId) ?? null
  const selectedElement = selectedElementId != null ? elementIndex.get(selectedElementId) ?? null : null
  const selectedElementLayer = selectedElement ? layersList.find((l) => l.id === selectedElement.layer_id) ?? null : null
  const frameLayer = frameLayerId != null ? layersList.find((l) => l.id === frameLayerId) ?? null : null
  const currentLevelText = level != null ? levelLabel(layersList, level) : ""

  const canvasDraft: PlanDraft | null =
    mode === "dibujar" && draft && draft.points.length > 0
      ? {
          layerId: draft.layerId,
          type: draft.type,
          points: draft.points,
          color: elementColor({ element_type: draft.elementType }, activeLayer),
        }
      : null

  let marker: PlanMarker | null = null
  if (reportPoint && (reportOpen || mode === "reportar")) marker = { ...reportPoint, kind: "report" }
  else if (taskMarker && levelLayers.some((l) => l.id === taskMarker.layerId)) marker = taskMarker

  // --- Acciones ------------------------------------------------------------------------

  function deselectFinding() {
    setSelectedFindingId(null)
    if (panelTab === "detalle") setPanelTab("hallazgos")
    syncFindingInUrl(null)
  }

  function exitMode() {
    setMode("navegar")
    setDraft(null)
    setPlacing(null)
    setReportPoint(null)
  }

  function changeLevel(l: number, keepFinding = false) {
    setLevel(l)
    setActiveLayerId(defaultActiveLayer(layersList, l))
    setSelectedElementId(null)
    setTaskMarker(null)
    if (mode !== "navegar") exitMode()
    if (!keepFinding && selectedPin && selectedPin.level !== l) deselectFinding()
  }

  function selectFinding(findingId: number, center: boolean) {
    const pin = pins.find((p) => p.finding_id === findingId)
    if (!pin) return
    const otherLevel = pin.level !== level
    if (otherLevel) changeLevel(pin.level, true)
    openFinding(pin, layersList, center || otherLevel)
  }

  function switchMode(m: PlanMode) {
    if (m === mode) return
    if (m === "navegar") {
      exitMode()
      return
    }
    if (!activeLayer) {
      toast.error("Primero elige una capa activa en este nivel (pestaña Capas).")
      return
    }
    if (m === "reportar" && !canReport) return
    if (m === "dibujar" && !canManagePlans) return
    setPlacing(null)
    setReportPoint(null)
    setSelectedElementId(null)
    setDraft(m === "dibujar" ? newElementDraft(activeLayer) : null)
    setMode(m)
    if (!isDesktop) setSheetOpen(false)
  }

  function changeActiveLayer(id: number) {
    setActiveLayerId(id)
    const layer = layersList.find((l) => l.id === id)
    if (mode === "dibujar" && layer) setDraft(newElementDraft(layer))
    if (layer && (hiddenLayerIds.includes(id) || hiddenDisciplines.includes(layer.discipline))) {
      setHiddenLayerIds((p) => p.filter((x) => x !== id))
      setHiddenDisciplines((p) => p.filter((d) => d !== layer.discipline))
    }
  }

  async function placeExisting(target: { id: number; title: string }, layer: PlanLayer, p: { x: number; y: number }) {
    setPlacingBusy(true)
    const r = await callAction(() =>
      pinExistingObraFinding(projectId, { finding_id: target.id, layer_id: layer.id, x: p.x, y: p.y }),
    )
    setPlacingBusy(false)
    if (r.ok === false) {
      toast.error(r.error)
      return
    }
    exitMode()
    setPins((prev) => [r.data, ...prev.filter((x) => x.finding_id !== r.data.finding_id)])
    setUnpinned((prev) => (prev ? prev.filter((f) => f.id !== target.id) : prev))
    toast.success(`Hallazgo «${target.title}» ubicado en el plano.`)
    openFinding(r.data, layersList, false)
  }

  function handlePlanClick(info: PlanClickInfo) {
    if (!activeLayer || placingBusy) return
    if (!info.inside || !info.norm) {
      toast.error(`Ese punto queda fuera de la lámina de «${activeLayer.name}». Toca dentro de ella o cambia la capa activa.`)
      return
    }
    const p = { x: clamp01(info.norm.x), y: clamp01(info.norm.y) }
    if (mode === "reportar") {
      if (placing) {
        void placeExisting(placing, activeLayer, p)
        return
      }
      setReportPoint({ layerId: activeLayer.id, ...p })
      setReportOpen(true)
    } else if (mode === "dibujar") {
      setDraft((d) => {
        const base = d && d.layerId === activeLayer.id ? d : newElementDraft(activeLayer)
        return { ...base, points: base.type === "point" ? [p] : [...base.points, p] }
      })
    }
  }

  function onReported(result: ReportFindingResult) {
    setPins((prev) => [result.pin, ...prev.filter((p) => p.finding_id !== result.pin.finding_id)])
    exitMode()
    openFinding(result.pin, layersList, false)
    const n = result.suggestions.length
    toast.success("Gracias. El equipo de prevención revisará este reporte.", {
      description: canViewFindings
        ? n > 0
          ? `Se generaron ${n} sugerencia${n === 1 ? "" : "s"} pendiente${n === 1 ? "" : "s"} de aprobación a partir de los planos.`
          : "No se encontraron redes ni elementos cercanos en los planos cargados."
        : undefined,
    })
  }

  async function loadUnpinned() {
    if (unpinnedLoading) return
    setUnpinnedLoading(true)
    const r = await callAction(() => listUnpinnedObraFindings(projectId))
    setUnpinnedLoading(false)
    if (r.ok === false) {
      toast.error(r.error)
      return
    }
    setUnpinned(r.data)
  }

  function startPlacing(f: UnpinnedFinding) {
    if (!activeLayer) {
      toast.error("Primero elige una capa activa en este nivel (pestaña Capas).")
      return
    }
    setDraft(null)
    setSelectedElementId(null)
    setPlacing({ id: f.id, title: f.title })
    setMode("reportar")
    if (!isDesktop) setSheetOpen(false)
  }

  async function afterLayerCreated(layer: PlanLayer) {
    await reloadLayers()
    setHiddenLayerIds((p) => p.filter((x) => x !== layer.id))
    setHiddenDisciplines((p) => p.filter((d) => d !== layer.discipline))
    if (mode !== "navegar") exitMode()
    setLevel(layer.level)
    setActiveLayerId(layer.id)
    setPanelTab("capas")
    void loadLevel(layer.level, true)
  }

  async function afterLayerDeleted(layer: PlanLayer) {
    const ls = await reloadLayers()
    setElementsByLevel((prev) => ({
      ...prev,
      [layer.level]: (prev[layer.level] ?? []).filter((e) => e.layer_id !== layer.id),
    }))
    if (selectedPin?.layer_id === layer.id) deselectFinding()
    void reloadPins()
    if (!ls) return
    if (!ls.some((l) => l.level === level)) {
      const next = defaultLevel(ls)
      setLevel(next)
      setActiveLayerId(defaultActiveLayer(ls, next))
    } else if (activeLayerId === layer.id) {
      setActiveLayerId(defaultActiveLayer(ls, level))
    }
  }

  function afterLayerSaved(updated: PlanLayer, previous: PlanLayer) {
    setLayers((prev) => (prev ? prev.map((l) => (l.id === updated.id ? updated : l)) : prev))
    if (updated.level !== previous.level) {
      void loadLevel(previous.level, true)
      void loadLevel(updated.level, true)
      void reloadPins()
    }
    if (selectedFindingId != null) context.reload()
  }

  function afterElementsChanged(layerId: number) {
    const layer = layersList.find((l) => l.id === layerId)
    if (layer) void loadLevel(layer.level, true)
    void reloadLayers()
    if (selectedFindingId != null) context.reload()
  }

  function openFrameDialog(layer: PlanLayer) {
    void loadLevel(layer.level)
    setFrameLayerId(layer.id)
  }

  // --- Render ------------------------------------------------------------------------

  if (loadError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>No se pudieron cargar los planos</AlertTitle>
        <AlertDescription>
          <p>{loadError}</p>
          <Button type="button" variant="outline" className="mt-2 h-10" onClick={() => void init()}>
            <RotateCw className="h-4 w-4" aria-hidden />
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (layers === null) {
    return (
      <div
        className="flex h-[60dvh] min-h-[320px] items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Cargando los planos de la obra…
      </div>
    )
  }

  if (layers.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border bg-card px-5 py-12 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-[14px] bg-secondary">
            <Layers className="h-6 w-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-display text-lg font-semibold">Esta obra aún no tiene planos</p>
          {canManagePlans ? (
            <>
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                Sube primero la lámina de arquitectura del primer piso y luego las de alcantarillado, agua potable,
                electricidad y gas. Con las capas cargadas, cada hallazgo se cruza con las redes que pasan cerca.
              </p>
              <Button type="button" className="mt-4 h-10" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" aria-hidden />
                Subir la primera capa
              </Button>
            </>
          ) : (
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Cuando el jefe de obra o el prevencionista suban los planos, podrás verlos aquí
              {canReport ? " y reportar problemas tocando el lugar exacto" : ""}.
            </p>
          )}
        </div>
        {canManagePlans ? (
          <LayerUploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            projectId={projectId}
            defaultLevel={0}
            layers={layersList}
            onCreated={(layer) => void afterLayerCreated(layer)}
          />
        ) : null}
      </>
    )
  }

  const modes: { value: PlanMode; label: string; short: string; icon: typeof Hand; show: boolean }[] = [
    { value: "navegar", label: "Navegar", short: "Navegar", icon: Hand, show: true },
    { value: "reportar", label: "Reportar hallazgo", short: "Reportar", icon: MapPinPlus, show: canReport },
    { value: "dibujar", label: "Dibujar elemento", short: "Dibujar", icon: PenLine, show: canManagePlans },
  ]
  const visibleModes = modes.filter((m) => m.show)

  const panel = (
    <Tabs value={panelTab} onValueChange={(v) => setPanelTab(v as PanelTab)} className="gap-3">
      <TabsList className="grid h-11 w-full grid-cols-3">
        <TabsTrigger value="capas" className="h-full">
          Capas
        </TabsTrigger>
        <TabsTrigger value="hallazgos" className="h-full">
          Hallazgos
          <span className="rounded-full bg-secondary px-1.5 text-[11px] text-muted-foreground">{levelPins.length}</span>
        </TabsTrigger>
        <TabsTrigger value="detalle" className="h-full" disabled={selectedFindingId == null}>
          Detalle
        </TabsTrigger>
      </TabsList>
      <TabsContent value="capas">
        <LayerPanel
          projectId={projectId}
          role={role}
          layers={layersList}
          level={level}
          activeLayerId={activeLayerId}
          onActiveLayerChange={changeActiveLayer}
          hiddenLayerIds={hiddenLayerIds}
          onToggleLayer={(id) => setHiddenLayerIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
          hiddenDisciplines={hiddenDisciplines}
          onToggleDiscipline={(d) => setHiddenDisciplines((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))}
          opacity={opacity}
          onOpacityChange={(id, v) => setOpacity((p) => ({ ...p, [id]: v }))}
          showPins={showPins}
          onShowPinsChange={setShowPins}
          showLabels={showLabels}
          onShowLabelsChange={setShowLabels}
          onUpload={() => setUploadOpen(true)}
          onAlign={openFrameDialog}
          onDeleted={(l) => void afterLayerDeleted(l)}
        />
      </TabsContent>
      <TabsContent value="hallazgos">
        <FindingsList
          pins={allLevelsFindings ? pins : levelPins}
          layers={layersList}
          showLevel={allLevelsFindings}
          allLevels={allLevelsFindings}
          onAllLevelsChange={setAllLevelsFindings}
          selectedFindingId={selectedFindingId}
          onSelect={(id) => selectFinding(id, true)}
          canReport={canReport}
          onlyOwn={!canViewFindings}
          levelText={currentLevelText}
          unpinned={canViewFindings && canReport ? unpinned : undefined}
          unpinnedLoading={unpinnedLoading}
          onLoadUnpinned={() => void loadUnpinned()}
          onPlace={startPlacing}
          placingId={placing?.id ?? null}
        />
      </TabsContent>
      <TabsContent value="detalle">
        {selectedFindingId != null ? (
          <FindingContextPanel
            projectId={projectId}
            role={role}
            currentUserId={currentUserId}
            today={today}
            context={context}
            layers={layersList}
            onClose={deselectFinding}
            onDataChanged={() => void reloadPins()}
            onRequestUpload={canManagePlans ? () => setUploadOpen(true) : undefined}
            onShowOnPlan={
              selectedPin
                ? () => {
                    if (selectedPin.level !== level) changeLevel(selectedPin.level, true)
                    focusOn(pinMeters(selectedPin, layersList), 20)
                    if (!isDesktop) setSheetOpen(false)
                  }
                : undefined
            }
          />
        ) : (
          <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
            Toca un hallazgo en el plano o en la lista para ver su contexto.
          </p>
        )}
      </TabsContent>
    </Tabs>
  )

  const sheetTitle = selectedPin
    ? `Hallazgo: ${selectedPin.title}`
    : `Capas y hallazgos · ${currentLevelText}`

  return (
    <div className="space-y-3 pb-24 lg:pb-0">
      {/* Barra superior: nivel, modo y subir capa */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[150px] flex-1 space-y-1 sm:max-w-[260px] sm:flex-none">
          <Label htmlFor="plan-level" className="text-xs text-muted-foreground">
            Nivel
          </Label>
          <Select value={level != null ? String(level) : undefined} onValueChange={(v) => changeLevel(Number(v))}>
            <SelectTrigger id="plan-level" className="h-10 w-full sm:w-[240px]">
              <SelectValue placeholder="Elige un nivel" />
            </SelectTrigger>
            <SelectContent>
              {levels.map((l) => {
                const text = levelLabel(layersList, l)
                const count = pins.filter((p) => p.level === l).length
                return (
                  <SelectItem key={l} value={String(l)} className="min-h-10">
                    {text}
                    {text !== `Nivel ${l}` ? ` · nivel ${l}` : ""}
                    {count > 0 ? ` · ${count} hallazgo${count === 1 ? "" : "s"}` : ""}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        {visibleModes.length > 1 ? (
          <div role="radiogroup" aria-label="Qué hacer en el plano" className="flex rounded-[12px] bg-secondary p-1">
            {visibleModes.map((m) => {
              const on = mode === m.value
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => switchMode(m.value)}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    on
                      ? m.value === "navegar"
                        ? "bg-card shadow-sm"
                        : "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <m.icon className="h-4 w-4" aria-hidden />
                  <span className="sm:hidden">{m.short}</span>
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              )
            })}
          </div>
        ) : null}
        {canManagePlans ? (
          <Button type="button" variant="outline" className="h-10 rounded-[10px] lg:ml-auto" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden />
            Subir capa
          </Button>
        ) : null}
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-4">
        <div className="min-w-0 space-y-2">
          {/* Explicación del modo activo */}
          {mode !== "navegar" && activeLayer ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-[12px] border border-brand/50 bg-brand/10 px-3 py-2 text-[13px]"
            >
              {mode === "reportar" ? (
                <MapPinPlus className="h-4 w-4 shrink-0 text-[#b8841a]" aria-hidden />
              ) : (
                <PenLine className="h-4 w-4 shrink-0 text-[#b8841a]" aria-hidden />
              )}
              <p className="min-w-0 flex-1">
                {placing ? (
                  <>
                    Toca el plano donde está «<span className="font-semibold">{placing.title}</span>».{" "}
                  </>
                ) : mode === "reportar" ? (
                  "Toca el plano en el lugar exacto del problema. "
                ) : (
                  "Toca el plano para marcar el elemento. "
                )}
                Quedará en la capa activa <span className="font-semibold">«{activeLayer.name}»</span> (
                {DISCIPLINE_LABELS[activeLayer.discipline].split(" (")[0]}).
              </p>
              {levelLayers.length > 1 ? (
                <Select value={String(activeLayer.id)} onValueChange={(v) => changeActiveLayer(Number(v))}>
                  <SelectTrigger className="h-10 w-full bg-card sm:w-[220px]" aria-label="Cambiar la capa activa">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levelLayers.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)} className="min-h-10">
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {placingBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Guardando ubicación" /> : null}
              <Button type="button" variant="ghost" className="h-10" onClick={exitMode}>
                <X className="h-4 w-4" aria-hidden />
                Cancelar
              </Button>
            </div>
          ) : null}

          {mode === "dibujar" && draft && activeLayer ? (
            <ElementDrawToolbar
              layer={activeLayer}
              draft={draft}
              onDraftChange={setDraft}
              onCancel={exitMode}
              onSaved={afterElementsChanged}
              finishSignal={finishSignal}
            />
          ) : null}

          <div className="relative h-[58dvh] min-h-[340px] lg:h-[calc(100dvh-240px)] lg:min-h-[520px]">
            <PlanCanvas
              layers={visibleLayers}
              elements={levelElements}
              frameLayers={layersList}
              layerOpacity={opacity}
              activeLayerId={activeLayer?.id ?? null}
              pins={levelPins}
              showPins={showPins}
              showLabels={showLabels}
              selectedFindingId={selectedFindingId}
              correlations={selectedPin && selectedPin.level === level ? correlations : null}
              elementIndex={elementIndex}
              selectedElementId={selectedElementId}
              draft={canvasDraft}
              marker={marker}
              mode={mode}
              focus={focus}
              fitKey={level ?? "sin-nivel"}
              onPlanClick={handlePlanClick}
              onPlanDoubleClick={() => {
                if (mode === "dibujar") setFinishSignal((n) => n + 1)
              }}
              onSelectFinding={(id) => selectFinding(id, false)}
              onSelectElement={setSelectedElementId}
              ariaLabel={`Plano de ${currentLevelText}: ${visibleLayers.length} capa${visibleLayers.length === 1 ? "" : "s"} visible${visibleLayers.length === 1 ? "" : "s"} y ${levelPins.length} hallazgo${levelPins.length === 1 ? "" : "s"}`}
            >
              {visibleLayers.length === 0 ? (
                <p className="pointer-events-none absolute inset-x-3 top-3 rounded-[10px] bg-card/95 px-3 py-2 text-center text-[13px] text-muted-foreground shadow-sm">
                  Todas las capas de este nivel están ocultas. Actívalas en la pestaña Capas.
                </p>
              ) : null}
              {level != null && loadingLevels.includes(level) ? (
                <p
                  className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-[12px] text-muted-foreground shadow-sm"
                  role="status"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Cargando elementos…
                </p>
              ) : null}
              {selectedElement ? (
                <SelectedElementCard
                  key={selectedElement.id}
                  element={selectedElement}
                  layer={selectedElementLayer}
                  canManage={canManagePlans}
                  onClose={() => setSelectedElementId(null)}
                  onUpdated={() => afterElementsChanged(selectedElement.layer_id)}
                  onDeleted={(_id, layerId) => {
                    setSelectedElementId(null)
                    afterElementsChanged(layerId)
                  }}
                  className="absolute left-3 top-3 z-10 w-[min(320px,calc(100%-24px))]"
                />
              ) : null}
            </PlanCanvas>
          </div>
          <Legend layers={visibleLayers} />
        </div>

        {isDesktop ? (
          <aside
            aria-label="Panel del plano"
            className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-120px)] lg:overflow-y-auto lg:pr-1"
          >
            {panel}
          </aside>
        ) : null}
      </div>

      {!isDesktop ? (
        <section
          aria-label="Panel del plano"
          className="fixed inset-x-0 bottom-0 z-30 rounded-t-[18px] border-t border-border bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
        >
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            aria-expanded={sheetOpen}
            aria-controls="plan-sheet-content"
            className="flex min-h-14 w-full flex-col items-center gap-1 px-4 pb-2 pt-2 outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            <span className="h-1.5 w-10 rounded-full bg-border" aria-hidden />
            <span className="flex w-full items-center gap-2 text-left text-sm font-semibold">
              <span className="min-w-0 flex-1 truncate">{sheetTitle}</span>
              <span className="sr-only">{sheetOpen ? "Ocultar panel" : "Mostrar panel"}</span>
              <ChevronUp className={cn("h-5 w-5 shrink-0 transition-transform", sheetOpen && "rotate-180")} aria-hidden />
            </span>
          </button>
          <div
            id="plan-sheet-content"
            hidden={!sheetOpen}
            className="max-h-[62dvh] overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {panel}
          </div>
        </section>
      ) : null}

      {canReport ? (
        <ReportFindingDialog
          open={reportOpen}
          onOpenChange={(o) => {
            setReportOpen(o)
            if (!o) setReportPoint(null)
          }}
          projectId={projectId}
          layer={reportPoint ? layersList.find((l) => l.id === reportPoint.layerId) ?? null : null}
          point={reportPoint}
          levelText={currentLevelText}
          onReported={onReported}
        />
      ) : null}

      {canManagePlans ? (
        <>
          <LayerUploadDialog
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            projectId={projectId}
            defaultLevel={level}
            layers={layersList}
            onCreated={(layer) => void afterLayerCreated(layer)}
          />
          <LayerFrameDialog
            open={frameLayer != null}
            onOpenChange={(o) => {
              if (!o) setFrameLayerId(null)
            }}
            layer={frameLayer}
            levelLayers={frameLayer ? layersList.filter((l) => l.level === frameLayer.level) : EMPTY_LAYERS}
            elements={frameLayer ? elementsByLevel[frameLayer.level] ?? EMPTY_ELEMENTS : EMPTY_ELEMENTS}
            onSaved={(updated) => {
              if (frameLayer) afterLayerSaved(updated, frameLayer)
            }}
          />
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leyenda de especialidades visibles
// ---------------------------------------------------------------------------

function Legend({ layers }: { layers: PlanLayer[] }) {
  const disciplines = [...new Set(layers.map((l) => l.discipline))]
  if (disciplines.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground" aria-label="Colores por especialidad">
      {disciplines.map((d) => (
        <li key={d} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: elementColor({ element_type: "otro" }, { discipline: d }) }}
            aria-hidden
          />
          {DISCIPLINE_LABELS[d].split(" (")[0]}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Lista de hallazgos
// ---------------------------------------------------------------------------

type FindingsListProps = {
  pins: FindingPin[]
  layers: PlanLayer[]
  showLevel: boolean
  allLevels: boolean
  onAllLevelsChange: (v: boolean) => void
  selectedFindingId: number | null
  onSelect: (findingId: number) => void
  canReport: boolean
  /** El rol solo ve los hallazgos que reportó. */
  onlyOwn: boolean
  levelText: string
  /** undefined = el rol no puede ubicar hallazgos existentes. */
  unpinned?: UnpinnedFinding[] | null
  unpinnedLoading: boolean
  onLoadUnpinned: () => void
  onPlace: (f: UnpinnedFinding) => void
  placingId: number | null
}

function FindingsList({
  pins,
  layers,
  showLevel,
  allLevels,
  onAllLevelsChange,
  selectedFindingId,
  onSelect,
  canReport,
  onlyOwn,
  levelText,
  unpinned,
  unpinnedLoading,
  onLoadUnpinned,
  onPlace,
  placingId,
}: FindingsListProps) {
  const sorted = useMemo(
    () =>
      [...pins].sort((a, b) => {
        const openA = a.status === "open" || a.status === "in_progress" ? 1 : 0
        const openB = b.status === "open" || b.status === "in_progress" ? 1 : 0
        return (
          openB - openA ||
          (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
          b.created_at.localeCompare(a.created_at)
        )
      }),
    [pins],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          Hallazgos · {allLevels ? "todos los niveles" : levelText}
        </h2>
        <Button
          type="button"
          variant="ghost"
          className="h-10"
          aria-pressed={allLevels}
          onClick={() => onAllLevelsChange(!allLevels)}
        >
          {allLevels ? "Solo este nivel" : "Ver todos los niveles"}
        </Button>
      </div>
      {onlyOwn ? <p className="text-[12.5px] text-muted-foreground">Ves solo los hallazgos que tú reportaste.</p> : null}

      {sorted.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          {allLevels ? "No hay hallazgos ubicados en el plano." : "No hay hallazgos ubicados en este nivel."}
          {canReport ? " Usa «Reportar» y toca el plano donde está el problema." : ""}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((p) => {
            const selected = p.finding_id === selectedFindingId
            const closed = p.status === "resolved" || p.status === "closed"
            return (
              <li key={p.finding_id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.finding_id)}
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex min-h-14 w-full items-start gap-2.5 rounded-[12px] border px-3 py-2 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    selected ? "border-brand bg-brand/10" : "border-border bg-card",
                    closed && "opacity-70",
                  )}
                >
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-white shadow-sm"
                    style={{ background: SEVERITY_COLOR_VARS[p.severity] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 break-words text-[13.5px] font-medium">{p.title}</span>
                    <span className="block text-[11.5px] text-muted-foreground">
                      {FINDING_CATEGORY_LABELS[p.category] ?? p.category} · {FINDING_STATUS_LABELS[p.status] ?? p.status}
                      {showLevel ? ` · ${levelLabel(layers, p.level)}` : ""} · <TimeAgo iso={p.created_at} />
                    </span>
                  </span>
                  <SeverityBadge severity={p.severity} className="shrink-0" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {unpinned !== undefined ? (
        <details
          className="group rounded-[12px] border border-border bg-card"
          onToggle={(e) => {
            if (e.currentTarget.open && unpinned === null) onLoadUnpinned()
          }}
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-[12px] px-3 text-[13px] font-semibold outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <MapPinned className="h-4 w-4" aria-hidden />
            Hallazgos sin ubicar en el plano
            {unpinned ? (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{unpinned.length}</span>
            ) : null}
          </summary>
          <div className="space-y-2 px-3 pb-3">
            <p className="text-[12px] text-muted-foreground">
              Hallazgos registrados en el módulo de hallazgos que aún no tienen ubicación. Ubícalos para cruzarlos con los
              planos.
            </p>
            {unpinnedLoading ? (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Cargando…
              </p>
            ) : unpinned && unpinned.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Todos los hallazgos de la obra ya están ubicados.</p>
            ) : (
              <ul className="space-y-1.5">
                {(unpinned ?? []).map((f) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-[10px] border border-border px-2.5 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 break-words text-[13px] font-medium">{f.title}</span>
                      <SeverityBadge severity={f.severity} className="mt-0.5" />
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 shrink-0"
                      onClick={() => onPlace(f)}
                      disabled={placingId === f.id}
                    >
                      <MapPinPlus className="h-4 w-4" aria-hidden />
                      Ubicar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      ) : null}
    </div>
  )
}
