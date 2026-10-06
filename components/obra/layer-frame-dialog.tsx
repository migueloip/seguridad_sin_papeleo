"use client"

/**
 * Alinear y editar una capa (permiso plans.manage). La alineación (ancho real,
 * desplazamientos y rotación) y la opacidad se ven en vivo sobre las demás
 * capas del mismo nivel antes de guardar con updateObraLayer. También permite
 * cambiar nombre, especialidad, nivel y nombre del nivel.
 */
import { useId, useMemo, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2, RotateCcw, RotateCw, Undo2 } from "lucide-react"
import { updateObraLayer } from "@/app/actions/obra/layers"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { sanitizeFrame } from "@/lib/obra/geometry"
import {
  DISCIPLINE_LABELS,
  DISCIPLINES,
  type Discipline,
  type LayerFrame,
  type PlanElement,
  type PlanLayer,
} from "@/lib/obra/types"
import { formatNumberCL, PlanCanvas } from "./plan-canvas"
import { callAction } from "./task-card"

/** Límites (espejo de LAYER_LIMITS en lib/obra/server/layers.ts). */
const LIMITS = {
  nameMax: 120,
  levelMin: -10,
  levelMax: 200,
  levelLabelMax: 100,
  widthMin: 1,
  widthMax: 5000,
  offsetMax: 10_000,
  rotationMax: 360,
} as const

function toInput(n: number, decimals = 2): string {
  return formatNumberCL(n, decimals).replace(/\./g, "")
}

function parseDecimal(s: string): number {
  const t = s.trim().replace(",", ".")
  return t === "" || t === "-" ? NaN : Number(t)
}

export type LayerFrameDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  layer: PlanLayer | null
  /** Capas del mismo nivel (incluida la editada) para la vista previa. */
  levelLayers: PlanLayer[]
  /** Elementos del nivel para la vista previa. */
  elements: PlanElement[]
  onSaved: (layer: PlanLayer) => void
}

export function LayerFrameDialog(props: LayerFrameDialogProps) {
  const { open, onOpenChange, layer } = props
  const [saving, setSaving] = useState(false)
  return (
    <Dialog open={open && layer != null} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle>Alinear y editar capa</DialogTitle>
          <DialogDescription className="break-words">
            {layer ? `«${layer.name}». ` : ""}Ajusta el ancho real, la posición y el giro hasta que la lámina calce con las
            demás capas del nivel. La vista previa se actualiza en vivo.
          </DialogDescription>
        </DialogHeader>
        {open && layer ? <FrameForm {...props} layer={layer} onSavingChange={setSaving} /> : null}
      </DialogContent>
    </Dialog>
  )
}

type NumberFieldProps = {
  id: string
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
  min: number
  max: number
  step: number
  sliderMin: number
  sliderMax: number
  hint?: string
}

function NumberField({ id, label, unit, value, onChange, min, max, step, sliderMin, sliderMax, hint }: NumberFieldProps) {
  const n = parseDecimal(value)
  const sliderValue = Number.isFinite(n) ? Math.min(sliderMax, Math.max(sliderMin, n)) : sliderMin
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-1.5">
          <Input
            id={id}
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-24 text-right tabular-nums"
            aria-invalid={!Number.isFinite(n) || n < min || n > max}
            aria-describedby={hint ? `${id}-hint` : undefined}
          />
          <span className="w-6 text-[12px] text-muted-foreground">{unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={step}
        value={sliderValue}
        onChange={(e) => onChange(toInput(Number(e.target.value), step < 1 ? 2 : 0))}
        className="h-8 w-full cursor-pointer accent-[#f3a40a]"
        aria-label={`${label} (control deslizante)`}
        aria-valuetext={`${value} ${unit}`}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-[11.5px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function FrameForm({
  layer,
  levelLayers,
  elements,
  onOpenChange,
  onSaved,
  onSavingChange,
}: LayerFrameDialogProps & { layer: PlanLayer; onSavingChange: (saving: boolean) => void }) {
  const formId = useId()
  const saved = sanitizeFrame(layer.frame)
  const initial = {
    width: toInput(saved.width_m),
    ox: toInput(saved.offset_x_m),
    oy: toInput(saved.offset_y_m),
    rot: toInput(saved.rotation_deg, 1),
    opacity: String(Math.round(layer.opacity * 100)),
  }
  const [width, setWidth] = useState(initial.width)
  const [ox, setOx] = useState(initial.ox)
  const [oy, setOy] = useState(initial.oy)
  const [rot, setRot] = useState(initial.rot)
  const [opacity, setOpacity] = useState(initial.opacity)
  const [name, setName] = useState(layer.name)
  const [discipline, setDiscipline] = useState<Discipline>(layer.discipline)
  const [level, setLevel] = useState(String(layer.level))
  const [levelLabelText, setLevelLabelText] = useState(layer.level_label ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Rangos de los controles deslizantes, fijados al abrir (los campos numéricos aceptan todo el rango).
  const [ranges] = useState(() => {
    const w = saved.width_m
    const span = Math.max(50, Math.round(w * 1.5))
    return {
      widthMax: Math.min(LIMITS.widthMax, Math.max(200, Math.round(w * 3))),
      oxMin: Math.round(saved.offset_x_m - span),
      oxMax: Math.round(saved.offset_x_m + span),
      oyMin: Math.round(saved.offset_y_m - span),
      oyMax: Math.round(saved.offset_y_m + span),
    }
  })

  const draftFrame: LayerFrame = useMemo(() => {
    const pick = (s: string, fallback: number, lo: number, hi: number) => {
      const n = parseDecimal(s)
      return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback
    }
    return {
      width_m: pick(width, saved.width_m, LIMITS.widthMin, LIMITS.widthMax),
      aspect: saved.aspect,
      offset_x_m: pick(ox, saved.offset_x_m, -LIMITS.offsetMax, LIMITS.offsetMax),
      offset_y_m: pick(oy, saved.offset_y_m, -LIMITS.offsetMax, LIMITS.offsetMax),
      rotation_deg: pick(rot, saved.rotation_deg, -LIMITS.rotationMax, LIMITS.rotationMax),
    }
  }, [width, ox, oy, rot, saved.width_m, saved.aspect, saved.offset_x_m, saved.offset_y_m, saved.rotation_deg])

  const opacityValue = Math.min(100, Math.max(0, Number(opacity) || 0)) / 100
  const previewLayers = useMemo(() => {
    const others = levelLayers.filter((l) => l.id !== layer.id)
    return [...others, layer]
  }, [levelLayers, layer])
  const overrides = useMemo(() => ({ [layer.id]: draftFrame }), [layer.id, draftFrame])
  const opacities = useMemo(() => ({ [layer.id]: opacityValue }), [layer.id, opacityValue])

  function rotateBy(delta: number) {
    const cur = parseDecimal(rot)
    let next = (Number.isFinite(cur) ? cur : 0) + delta
    if (next > 180) next -= 360
    if (next < -180) next += 360
    setRot(toInput(next, 1))
  }

  function reset() {
    setWidth(initial.width)
    setOx(initial.ox)
    setOy(initial.oy)
    setRot(initial.rot)
    setOpacity(initial.opacity)
    setName(layer.name)
    setDiscipline(layer.discipline)
    setLevel(String(layer.level))
    setLevelLabelText(layer.level_label ?? "")
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const w = parseDecimal(width)
    const x = parseDecimal(ox)
    const y = parseDecimal(oy)
    const r = parseDecimal(rot)
    const op = Number(opacity)
    const lvl = Number(level)
    const n = name.trim()
    if (!n) return setError("Escribe el nombre de la capa.")
    if (!Number.isFinite(w) || w < LIMITS.widthMin || w > LIMITS.widthMax) {
      return setError(`El ancho real debe estar entre ${LIMITS.widthMin} y ${LIMITS.widthMax} metros.`)
    }
    if (!Number.isFinite(x) || Math.abs(x) > LIMITS.offsetMax || !Number.isFinite(y) || Math.abs(y) > LIMITS.offsetMax) {
      return setError(`Los desplazamientos deben estar entre −${LIMITS.offsetMax} y ${LIMITS.offsetMax} metros.`)
    }
    if (!Number.isFinite(r) || Math.abs(r) > LIMITS.rotationMax) return setError("La rotación debe estar entre −360 y 360 grados.")
    if (!Number.isFinite(op) || op < 0 || op > 100) return setError("La opacidad debe estar entre 0 y 100 %.")
    if (level.trim() === "" || !Number.isInteger(lvl) || lvl < LIMITS.levelMin || lvl > LIMITS.levelMax) {
      return setError(`El nivel debe ser un número entero entre ${LIMITS.levelMin} y ${LIMITS.levelMax}.`)
    }

    const patch: {
      name?: string
      discipline?: Discipline
      level?: number
      level_label?: string | null
      frame?: Partial<LayerFrame>
      opacity?: number
    } = {}
    if (n !== layer.name) patch.name = n
    if (discipline !== layer.discipline) patch.discipline = discipline
    if (lvl !== layer.level) patch.level = lvl
    const ll = levelLabelText.trim() || null
    if (ll !== (layer.level_label ?? null)) patch.level_label = ll
    const frame: Partial<LayerFrame> = {}
    if (Math.abs(w - saved.width_m) > 1e-9) frame.width_m = w
    if (Math.abs(x - saved.offset_x_m) > 1e-9) frame.offset_x_m = x
    if (Math.abs(y - saved.offset_y_m) > 1e-9) frame.offset_y_m = y
    if (Math.abs(r - saved.rotation_deg) > 1e-9) frame.rotation_deg = r
    if (Object.keys(frame).length > 0) patch.frame = frame
    if (Math.abs(op / 100 - layer.opacity) > 1e-9) patch.opacity = op / 100
    if (Object.keys(patch).length === 0) {
      toast.info("No hay cambios que guardar.")
      onOpenChange(false)
      return
    }
    setError(null)
    setSaving(true)
    onSavingChange(true)
    const res = await callAction(() => updateObraLayer(layer.id, patch))
    setSaving(false)
    onSavingChange(false)
    if (res.ok === false) {
      toast.error(res.error)
      return
    }
    toast.success(
      patch.level !== undefined
        ? `Capa actualizada y movida al nivel ${lvl}, junto con sus hallazgos.`
        : "Capa actualizada. Las distancias a los hallazgos ya usan la nueva alineación.",
    )
    onSaved(res.data)
    onOpenChange(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-1.5">
          <div className="h-[300px] sm:h-[380px]">
            <PlanCanvas
              layers={previewLayers}
              elements={elements}
              frameOverrides={overrides}
              layerOpacity={opacities}
              activeLayerId={layer.id}
              outlineActive
              fitKey={`frame-${layer.id}`}
              selectable={false}
              showPins={false}
              ariaLabel={`Vista previa de la alineación de «${layer.name}» sobre las demás capas del nivel`}
            />
          </div>
          <p className="text-[12px] text-muted-foreground">
            El contorno ámbar es la capa que estás alineando. Usa el botón de encajar si se sale de la vista.
          </p>
        </div>

        <Tabs defaultValue="alinear" className="min-w-0">
          <TabsList className="grid h-10 w-full grid-cols-2">
            <TabsTrigger value="alinear">Alinear</TabsTrigger>
            <TabsTrigger value="datos">Datos</TabsTrigger>
          </TabsList>
          <TabsContent value="alinear" className="space-y-3 pt-1">
            <NumberField
              id={`${formId}-w`}
              label="Ancho real"
              unit="m"
              value={width}
              onChange={setWidth}
              min={LIMITS.widthMin}
              max={LIMITS.widthMax}
              step={0.1}
              sliderMin={LIMITS.widthMin}
              sliderMax={ranges.widthMax}
              hint="Cuántos metros reales cubre la lámina de lado a lado."
            />
            <NumberField
              id={`${formId}-x`}
              label="Mover a la derecha"
              unit="m"
              value={ox}
              onChange={setOx}
              min={-LIMITS.offsetMax}
              max={LIMITS.offsetMax}
              step={0.1}
              sliderMin={ranges.oxMin}
              sliderMax={ranges.oxMax}
            />
            <NumberField
              id={`${formId}-y`}
              label="Mover hacia abajo"
              unit="m"
              value={oy}
              onChange={setOy}
              min={-LIMITS.offsetMax}
              max={LIMITS.offsetMax}
              step={0.1}
              sliderMin={ranges.oyMin}
              sliderMax={ranges.oyMax}
            />
            <NumberField
              id={`${formId}-r`}
              label="Girar"
              unit="°"
              value={rot}
              onChange={setRot}
              min={-LIMITS.rotationMax}
              max={LIMITS.rotationMax}
              step={0.5}
              sliderMin={-180}
              sliderMax={180}
              hint="Positivo = sentido horario."
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => rotateBy(-90)}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                −90°
              </Button>
              <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => rotateBy(90)}>
                <RotateCw className="h-4 w-4" aria-hidden />
                +90°
              </Button>
            </div>
            <NumberField
              id={`${formId}-o`}
              label="Opacidad"
              unit="%"
              value={opacity}
              onChange={setOpacity}
              min={0}
              max={100}
              step={5}
              sliderMin={0}
              sliderMax={100}
              hint="Se guarda para todos. Baja la opacidad para ver las capas de abajo."
            />
          </TabsContent>
          <TabsContent value="datos" className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-name`}>Nombre</Label>
              <Input
                id={`${formId}-name`}
                value={name}
                maxLength={LIMITS.nameMax}
                onChange={(e) => setName(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-disc`}>Especialidad</Label>
              <Select value={discipline} onValueChange={(v) => setDiscipline(v as Discipline)}>
                <SelectTrigger id={`${formId}-disc`} className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d} className="min-h-10">
                      {DISCIPLINE_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-level`}>Nivel</Label>
                <Input
                  id={`${formId}-level`}
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={LIMITS.levelMin}
                  max={LIMITS.levelMax}
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-ll`}>Nombre del nivel</Label>
                <Input
                  id={`${formId}-ll`}
                  value={levelLabelText}
                  maxLength={LIMITS.levelLabelMax}
                  onChange={(e) => setLevelLabelText(e.target.value)}
                  placeholder="Ej.: Subterráneo"
                  className="h-10"
                />
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              Si cambias el nivel, los hallazgos y tareas ubicados en esta capa se mueven con ella.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" className="h-10" disabled={saving} onClick={reset}>
          <Undo2 className="h-4 w-4" aria-hidden />
          Restablecer
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-10" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" className="h-10" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            Guardar cambios
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
