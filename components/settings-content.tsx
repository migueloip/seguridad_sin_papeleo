"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Key, Sparkles, Building, Save, Loader2, CheckCircle, Eye, EyeOff, ScanText, LayoutGrid, PenLine } from "lucide-react"
import { updateSettings, type Setting } from "@/app/actions/settings"

const NAV_SECTIONS = [
  { key: "hallazgos", label: "Hallazgos", desc: "Reporte y seguimiento de hallazgos" },
  { key: "documentos", label: "Documentos", desc: "Control documental y vencimientos" },
  { key: "informes", label: "Informes", desc: "Generación de reportes y actas" },
  { key: "personal", label: "Personal", desc: "Gestión de trabajadores de la obra" },
  { key: "planos", label: "Planos · Riesgos", desc: "Mapa de riesgos sobre planos" },
  { key: "checklists", label: "Checklists", desc: "Inspecciones y listas de verificación" },
]

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="relative h-6 w-[42px] shrink-0 rounded-full transition-colors"
      style={{ background: on ? "var(--primary)" : "#d9d4c9" }}
    >
      <span
        className="absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all"
        style={{ left: on ? "21px" : "3px" }}
      />
    </button>
  )
}

interface SettingsContentProps {
  initialSettings: Setting[]
}

export function SettingsContent({ initialSettings }: SettingsContentProps) {
  const router = useRouter()
  const [settings, setSettings] = useState<Record<string, string>>(
    initialSettings.reduce((acc, s) => ({ ...acc, [s.key]: s.value || "" }), {} as Record<string, string>),
  )
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    setSettings(initialSettings.reduce((acc, s) => ({ ...acc, [s.key]: s.value || "" }), {} as Record<string, string>))
    setSaved(false)
  }, [initialSettings])

  const handleSave = () => {
    startTransition(async () => {
      const settingsArray = Object.entries(settings).map(([key, value]) => ({ key, value }))
      await updateSettings(settingsArray)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      router.refresh()
    })
  }

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const navDisabled: string[] = (() => {
    try {
      const arr = JSON.parse(settings.nav_disabled || "[]")
      return Array.isArray(arr) ? arr.map(String) : []
    } catch {
      return []
    }
  })()
  const toggleNav = (key: string) => {
    const set = new Set(navDisabled)
    if (set.has(key)) set.delete(key)
    else set.add(key)
    updateSetting("nav_disabled", JSON.stringify([...set]))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Adapta el panel, la IA y los datos de tu empresa
        </p>
      </div>

      <Tabs defaultValue="ai" className="grid gap-5 lg:grid-cols-[210px_1fr] lg:items-start">
        <TabsList className="flex h-auto w-full flex-col gap-1 rounded-2xl border border-border bg-card p-2">
          <TabsTrigger
            value="ai"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium data-[state=active]:bg-primary data-[state=active]:text-sidebar-foreground"
          >
            <Sparkles className="h-4 w-4" />
            Inteligencia Artificial
          </TabsTrigger>
          <TabsTrigger
            value="ocr"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium data-[state=active]:bg-primary data-[state=active]:text-sidebar-foreground"
          >
            <ScanText className="h-4 w-4" />
            OCR
          </TabsTrigger>
          <TabsTrigger
            value="company"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium data-[state=active]:bg-primary data-[state=active]:text-sidebar-foreground"
          >
            <Building className="h-4 w-4" />
            Empresa
          </TabsTrigger>
          <TabsTrigger
            value="nav"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium data-[state=active]:bg-primary data-[state=active]:text-sidebar-foreground"
          >
            <LayoutGrid className="h-4 w-4" />
            Navegación
          </TabsTrigger>
          <TabsTrigger
            value="firma"
            className="w-full justify-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium data-[state=active]:bg-primary data-[state=active]:text-sidebar-foreground"
          >
            <PenLine className="h-4 w-4" />
            Firma
          </TabsTrigger>
        </TabsList>

        <div className="min-w-0 space-y-6">

        <TabsContent value="ai" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Configuracion de Google AI
              </CardTitle>
              <CardDescription>
                Configura la API Key de Google AI para funciones de IA como generacion de informes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ai_model">Modelo</Label>
                  <Select
                    value={settings.ai_model || "gemini-2.5-flash"}
                    onValueChange={(value) => updateSetting("ai_model", value)}
                  >
                    <SelectTrigger id="ai_model">
                      <SelectValue placeholder="Seleccionar modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                      <SelectItem value="gemini-1.5-pro-latest">Gemini 1.5 Pro (latest)</SelectItem>
                      <SelectItem value="gemini-1.5-flash-latest">Gemini 1.5 Flash (latest)</SelectItem>
                      <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai_api_key">API Key</Label>
                <div className="relative">
                  <Input
                    id="ai_api_key"
                    type={showApiKey ? "text" : "password"}
                    value={settings.ai_api_key || ""}
                    onChange={(e) => updateSetting("ai_api_key", e.target.value)}
                    placeholder="sk-..."
                    className="pr-10"
                    autoComplete="new-password"
                    name="ai-api-key"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tu API Key se almacena de forma segura y se usa para generar informes con IA
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai_report_style_examples">Formato preferido de informe</Label>
                <Textarea
                  id="ai_report_style_examples"
                  value={settings.ai_report_style_examples || ""}
                  onChange={(e) => updateSetting("ai_report_style_examples", e.target.value)}
                  rows={6}
                  placeholder="Pega ejemplos de informes o describe la estructura estandarizada que usa tu empresa."
                />
                <p className="text-xs text-muted-foreground">
                  La IA usará estos ejemplos como referencia para la forma de datos y el estilo de los informes.
                </p>
              </div>

              <div className="rounded-lg bg-muted p-4">
                <h4 className="mb-2 font-medium">Como obtener una API Key</h4>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>
                    <strong>Google AI:</strong> Visita{" "}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      className="text-primary underline"
                      rel="noreferrer"
                    >
                      aistudio.google.com
                    </a>
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ocr" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanText className="h-5 w-5" />
                Configuracion de OCR
              </CardTitle>
              <CardDescription>Selecciona el metodo para extraer texto de documentos escaneados</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="ocr_method">Metodo de OCR</Label>
                <Select
                  value={settings.ocr_method || "tesseract"}
                  onValueChange={(value) => updateSetting("ocr_method", value)}
                >
                  <SelectTrigger id="ocr_method">
                    <SelectValue placeholder="Seleccionar metodo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tesseract">Tesseract OCR (Local)</SelectItem>
                    <SelectItem value="ai">IA con Vision (Requiere API Key)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="border-2 border-primary/20">
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="font-medium">Tesseract OCR</h4>
                      <Badge variant="secondary">Gratuito</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Procesamiento local en el navegador. No requiere API Key. Bueno para documentos con texto claro.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="font-medium">IA con Vision</h4>
                      <Badge>Premium</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Usa modelos de IA con vision para mejor precision. Requiere API Key configurada.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="company" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Informacion de la Empresa
              </CardTitle>
              <CardDescription>Configura los datos de tu empresa para los informes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="company_name">Nombre de la Empresa</Label>
                <Input
                  id="company_name"
                  value={settings.company_name || ""}
                  onChange={(e) => updateSetting("company_name", e.target.value)}
                  placeholder="Mi Empresa S.A."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company_logo">URL del Logo</Label>
                <Input
                  id="company_logo"
                  value={settings.company_logo || ""}
                  onChange={(e) => updateSetting("company_logo", e.target.value)}
                  placeholder="https://example.com/logo.png"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nav" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LayoutGrid className="h-5 w-5" />
                Navegación
              </CardTitle>
              <CardDescription>Activa u oculta secciones del menú lateral</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {NAV_SECTIONS.map((s) => (
                <div key={s.key} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="font-medium">{s.label}</div>
                    <div className="text-sm text-muted-foreground">{s.desc}</div>
                  </div>
                  <Toggle on={!navDisabled.includes(s.key)} onClick={() => toggleNav(s.key)} />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Guarda los cambios para aplicarlos al menú lateral.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="firma" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PenLine className="h-5 w-5" />
                Firma del responsable
              </CardTitle>
              <CardDescription>Datos del responsable que firma los informes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium">Requerir firma en informes</div>
                  <div className="text-sm text-muted-foreground">
                    Exige la firma del responsable al exportar el PDF
                  </div>
                </div>
                <Toggle
                  on={settings.require_signature !== "off"}
                  onClick={() =>
                    updateSetting(
                      "require_signature",
                      settings.require_signature === "off" ? "on" : "off",
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="responsible_name">Nombre del responsable</Label>
                <Input
                  id="responsible_name"
                  value={settings.responsible_name || ""}
                  onChange={(e) => updateSetting("responsible_name", e.target.value)}
                  placeholder="Nombre y apellido"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        </div>
      </Tabs>

      <div className="flex items-center gap-4">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Guardar Configuracion
            </>
          )}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-success">
            <CheckCircle className="h-4 w-4" />
            Configuracion guardada
          </span>
        )}
      </div>
    </div>
  )
}
