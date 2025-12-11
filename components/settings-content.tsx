"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Key, Sparkles, Building, Save, Loader2, CheckCircle, Eye, EyeOff, ScanText } from "lucide-react"
import { updateSettings, type Setting } from "@/app/actions/settings"

interface SettingsContentProps {
  initialSettings: Setting[]
}

export function SettingsContent({ initialSettings }: SettingsContentProps) {
  const [settings, setSettings] = useState<Record<string, string>>(
    initialSettings.reduce((acc, s) => ({ ...acc, [s.key]: s.value || "" }), {} as Record<string, string>),
  )
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  const handleSave = () => {
    startTransition(async () => {
      const settingsArray = Object.entries(settings).map(([key, value]) => ({ key, value }))
      await updateSettings(settingsArray)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
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
        </TabsList>

        <TabsContent value="ai" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Configuracion de IA
              </CardTitle>
              <CardDescription>
                Configura el proveedor y la API Key para funciones de IA como generacion de informes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ai_provider">Proveedor de IA</Label>
                  <Select
                    value={settings.ai_provider || "openai"}
                    onValueChange={(value) => updateSetting("ai_provider", value)}
                  >
                    <SelectTrigger id="ai_provider">
                      <SelectValue placeholder="Seleccionar proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="google">Google AI</SelectItem>
                      <SelectItem value="groq">Groq</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai_model">Modelo</Label>
                  <Select
                    value={settings.ai_model || "gpt-4o-mini"}
                    onValueChange={(value) => updateSetting("ai_model", value)}
                  >
                    <SelectTrigger id="ai_model">
                      <SelectValue placeholder="Seleccionar modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      {settings.ai_provider === "openai" && (
                        <>
                          <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                          <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                          <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                        </>
                      )}
                      {settings.ai_provider === "anthropic" && (
                        <>
                          <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4</SelectItem>
                          <SelectItem value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</SelectItem>
                          <SelectItem value="claude-3-haiku-20240307">Claude 3 Haiku</SelectItem>
                        </>
                      )}
                      {settings.ai_provider === "google" && (
                        <>
                          <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                          <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash</SelectItem>
                        </>
                      )}
                      {settings.ai_provider === "groq" && (
                        <>
                          <SelectItem value="llama-3.1-70b-versatile">Llama 3.1 70B</SelectItem>
                          <SelectItem value="llama-3.1-8b-instant">Llama 3.1 8B</SelectItem>
                          <SelectItem value="mixtral-8x7b-32768">Mixtral 8x7B</SelectItem>
                        </>
                      )}
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
                    <strong>OpenAI:</strong> Visita{" "}
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      className="text-primary underline"
                      rel="noreferrer"
                    >
                      platform.openai.com/api-keys
                    </a>
                  </li>
                  <li>
                    <strong>Anthropic:</strong> Visita{" "}
                    <a
                      href="https://console.anthropic.com/"
                      target="_blank"
                      className="text-primary underline"
                      rel="noreferrer"
                    >
                      console.anthropic.com
                    </a>
                  </li>
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
                  <li>
                    <strong>Groq:</strong> Visita{" "}
                    <a
                      href="https://console.groq.com/keys"
                      target="_blank"
                      className="text-primary underline"
                      rel="noreferrer"
                    >
                      console.groq.com
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
