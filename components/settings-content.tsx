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
import { Key, Sparkles, Building, Save, Loader2, CheckCircle, Eye, EyeOff, ScanText, Mail } from "lucide-react"
import { updateSettings, type Setting } from "@/app/actions/settings"

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuracion</h1>
        <p className="text-muted-foreground">Administra la configuracion del sistema y las integraciones</p>
      </div>

      <Tabs defaultValue="ai" className="space-y-6">
        <TabsList>
          <TabsTrigger value="ai" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Inteligencia Artificial
          </TabsTrigger>
          <TabsTrigger value="ocr" className="flex items-center gap-2">
            <ScanText className="h-4 w-4" />
            OCR
          </TabsTrigger>
          <TabsTrigger value="company" className="flex items-center gap-2">
            <Building className="h-4 w-4" />
            Empresa
          </TabsTrigger>
          <TabsTrigger value="mail" className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Correo
          </TabsTrigger>
        </TabsList>

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

        <TabsContent value="mail" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Configuracion de Correo SMTP
              </CardTitle>
              <CardDescription>Configura el servidor SMTP para notificaciones por email</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="smtp_host">Servidor SMTP (host)</Label>
                  <Input
                    id="smtp_host"
                    value={settings.smtp_host || ""}
                    onChange={(e) => updateSetting("smtp_host", e.target.value)}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp_port">Puerto</Label>
                  <Input
                    id="smtp_port"
                    value={settings.smtp_port || ""}
                    onChange={(e) => updateSetting("smtp_port", e.target.value)}
                    placeholder="465 o 587"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp_user">Usuario</Label>
                  <Input
                    id="smtp_user"
                    value={settings.smtp_user || ""}
                    onChange={(e) => updateSetting("smtp_user", e.target.value)}
                    placeholder="usuario@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp_pass">Password</Label>
                  <Input
                    id="smtp_pass"
                    type="password"
                    value={settings.smtp_pass || ""}
                    onChange={(e) => updateSetting("smtp_pass", e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp_from">Remitente (from)</Label>
                  <Input
                    id="smtp_from"
                    value={settings.smtp_from || ""}
                    onChange={(e) => updateSetting("smtp_from", e.target.value)}
                    placeholder="noreply@empresa.cl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hr_email">Email RRHH</Label>
                  <Input
                    id="hr_email"
                    value={settings.hr_email || ""}
                    onChange={(e) => updateSetting("hr_email", e.target.value)}
                    placeholder="rrhh@empresa.cl"
                  />
                </div>
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
