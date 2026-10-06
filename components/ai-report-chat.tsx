
"use client"

import { useChat, type UIMessage } from "@ai-sdk/react"
import type { TextUIPart, ToolUIPart, UIDataTypes } from "ai"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "./ui/scroll-area"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Send, Bot, User, Sparkles, PlusCircle, Loader2 } from "lucide-react"
import type { DesignerElement, MatrixRow } from "@/lib/pdf-editor"

/** Entrada de la herramienta generateReportElement (espejo del esquema zod de app/api/chat/route.ts). */
type ReportElementInput = {
    type: "simple_section" | "table" | "matrix" | "list" | "heading" | "plain_text"
    title?: string
    content?: string
    data?: string
    instructions?: string
}

/** Herramientas que expone /api/chat, tipadas para las partes de mensaje de AI SDK v5. */
type ReportChatTools = {
    generateReportElement: {
        input: ReportElementInput
        output: { _action: "CREATE_ELEMENT"; elementData: ReportElementInput }
    }
    queryProjectData: {
        input: { dataType: "findings" | "documents" | "workers" | "summary"; period?: "weekly" | "monthly" | "all" }
        output: unknown
    }
}

type ReportChatMessage = UIMessage<unknown, UIDataTypes, ReportChatTools>
type ReportChatPart = ReportChatMessage["parts"][number]
type ReportToolPart = ToolUIPart<ReportChatTools>

const isTextPart = (part: ReportChatPart): part is TextUIPart => part.type === "text"

const isReportToolPart = (part: ReportChatPart): part is ReportToolPart =>
    part.type === "tool-generateReportElement" || part.type === "tool-queryProjectData"

interface AiReportChatProps {
    projectId?: number
    onAddElement: (element: DesignerElement) => void
}

export function AiReportChat({ projectId, onAddElement }: AiReportChatProps) {
    const [input, setInput] = useState("")
    const [accessType, setAccessType] = useState<null | "findings" | "documents" | "workers">(null)
    const [accessPeriod, setAccessPeriod] = useState<"weekly" | "monthly" | "all">("monthly")

    const { messages, status, sendMessage } = useChat<ReportChatMessage>({
        onFinish: ({ message }) => {
            handleToolsFromMessage(message)
        }
    })

    const isLoading = status === "submitted" || status === "streaming"

    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo(0, scrollRef.current.scrollHeight)
        }
    }, [messages])

    const handleCreateElement = (data: ReportElementInput | undefined) => {
        if (!data || typeof data !== "object") return
        const now = Date.now()
        let newElement: DesignerElement | null = null

        if (data.type === "simple_section") {
            newElement = {
                id: `sec-${now}`,
                type: "simple_section",
                title: data.title || "Nueva Sección",
                subtitle: null,
                body: data.content || "",
                bullets: [],
                chips: [],
                align: "left"
            }
        } else if (data.type === "heading") {
            newElement = {
                id: `head-${now}`,
                type: "heading",
                text: data.title || data.content || "Título",
                level: 2,
                align: "left"
            }
        } else if (data.type === "plain_text") {
            newElement = {
                id: `txt-${now}`,
                type: "plain_text",
                text: data.content || "",
                align: "left"
            }
        } else if (data.type === "table") {
            let rows = [["Col 1", "Col 2"], ["Dato 1", "Dato 2"]]
            try {
                if (data.data) rows = JSON.parse(data.data)
            } catch { }
            newElement = {
                id: `tbl-${now}`,
                type: "table",
                rows: rows
            }
        } else if (data.type === "list") {
            let items = ["Item 1", "Item 2"]
            try {
                if (data.data) items = JSON.parse(data.data)
                else if (data.content) items = data.content.split("\n")
            } catch { }
            newElement = {
                id: `lst-${now}`,
                type: "list",
                ordered: false,
                items
            }
        } else if (data.type === "matrix") {
            let rows: MatrixRow[] = []
            try {
                if (data.data) rows = JSON.parse(data.data)
            } catch { }
            newElement = {
                id: `mtx-${now}`,
                type: "matrix",
                rows
            }
        }

        if (newElement) {
            onAddElement(newElement)
        }
    }

    // En AI SDK v5 cada llamada a herramienta llega como una parte `tool-<nombre>`
    // cuyo resultado queda en `output` con state "output-available".
    const handleToolsFromMessage = (message: ReportChatMessage) => {
        for (const part of message.parts) {
            if (part.type !== "tool-generateReportElement" || part.state !== "output-available") continue
            if (part.output?._action === "CREATE_ELEMENT") {
                handleCreateElement(part.output.elementData)
            }
        }
    }

    const handleOpenAccessDialog = (type: "findings" | "documents" | "workers") => {
        setAccessType(type)
    }

    const handleConfirmAccess = () => {
        if (!accessType) return
        const periodLabel =
            accessPeriod === "weekly" ? "de la última semana" : accessPeriod === "all" ? "de todo el historial disponible" : "del último mes"
        const typeLabel =
            accessType === "findings" ? "hallazgos de seguridad" : accessType === "documents" ? "documentos del personal y gestión" : "datos de personal del proyecto"
        const dataType = accessType === "findings" ? "findings" : accessType === "documents" ? "documents" : "workers"
        const text = `Te doy acceso explícito a los ${typeLabel} del proyecto para que los uses en este informe. Usa la herramienta "queryProjectData" con dataType "${dataType}" y period "${accessPeriod}" para consultar los datos ${periodLabel} y luego continúa con lo que te pedí.`
        sendMessage({ text }, { body: { projectId } })
        setAccessType(null)
        setAccessPeriod("monthly")
    }

    return (
        <>
        <Card className="flex h-full flex-col border-0 shadow-none">
            <CardHeader className="border-b px-4 py-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Asistente IA
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-0">
                <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                    <div className="space-y-4">
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center space-y-2 py-8 text-center text-muted-foreground">
                                <Bot className="h-8 w-8 opacity-50" />
                                <p className="text-sm">¡Hola! Soy tu asistente de informes.</p>
                                <p className="text-xs">Puedo analizar tus datos y crear secciones por ti.</p>
                                <div className="grid gap-2 text-xs">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setInput("Genera un resumen mensual de hallazgos")}
                                    >
                                        📊 Resumen mensual
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setInput("Crea una tabla con los documentos vencidos")}
                                    >
                                        ⚠️ Docs vencidos
                                    </Button>
                                </div>
                            </div>
                        )}
                        {messages.map((m) => {
                            const text = m.parts
                                .filter(isTextPart)
                                .map((p) => p.text)
                                .join("")
                            const toolParts = m.parts.filter(isReportToolPart)

                            return (
                            <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                {m.role !== "user" && (
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                                        <Bot className="h-4 w-4" />
                                    </div>
                                )}
                                <div
                                    className={`relative max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                        }`}
                                >
                                    <div className="whitespace-pre-wrap">{text}</div>
                                    {toolParts.map((part) => {
                                        if (part.state !== "output-available") return null
                                        if (part.type === "tool-generateReportElement") {
                                            if (part.output?._action !== "CREATE_ELEMENT") return null
                                            return (
                                                <div key={part.toolCallId} className="mt-2 rounded bg-background/50 p-2 text-xs font-medium">
                                                    <div className="flex items-center gap-1 text-green-600">
                                                        <PlusCircle className="h-3 w-3" />
                                                        Elemento creado: {part.output.elementData?.type}
                                                    </div>
                                                </div>
                                            )
                                        }
                                        return (
                                            <div key={part.toolCallId} className="mt-2 rounded bg-background/50 p-2 text-xs text-muted-foreground">
                                                🔍 Datos consultados
                                            </div>
                                        )
                                    })}
                                </div>
                                {m.role === "user" && (
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                        <User className="h-4 w-4" />
                                    </div>
                                )}
                            </div>
                        )})}
                        {isLoading && (
                            <div className="flex justify-start gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                                    <Bot className="h-4 w-4" />
                                </div>
                                <div className="flex items-center gap-1 rounded-lg bg-muted px-3 py-2">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span className="text-xs text-muted-foreground">Pensando...</span>
                                </div>
                            </div>
                        )}
                        <div ref={scrollRef} />
                    </div>
                </ScrollArea>
                <div className="bg-background border-t p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>Dar acceso a datos del proyecto</span>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenAccessDialog("findings")}
                            >
                                Hallazgos
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenAccessDialog("documents")}
                            >
                                Documentos
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenAccessDialog("workers")}
                            >
                                Personal
                            </Button>
                        </div>
                    </div>
                    <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                            e.preventDefault()
                            const value = input.trim()
                            if (!value) return
                            sendMessage({ text: value }, { body: { projectId } })
                            setInput("")
                        }}
                    >
                        <Input
                            placeholder="Escribe tu instrucción..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            className="flex-1"
                        />
                        <Button type="submit" size="icon" disabled={isLoading}>
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                </div>
            </CardContent>
        </Card>
        <Dialog open={accessType !== null} onOpenChange={(open) => {
            if (!open) {
                setAccessType(null)
                setAccessPeriod("monthly")
            }
        }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Dar acceso a información</DialogTitle>
                    <DialogDescription>
                        Selecciona qué datos puede consultar el asistente de este proyecto y para qué periodo.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1 text-sm">
                        <div className="font-medium">
                            Tipo de datos
                        </div>
                        <div className="text-muted-foreground">
                            {accessType === "findings" && "Hallazgos de seguridad registrados en el proyecto."}
                            {accessType === "documents" && "Documentos asociados al personal y al proyecto."}
                            {accessType === "workers" && "Información básica del personal involucrado en el proyecto."}
                        </div>
                    </div>
                    <div className="space-y-2 text-sm">
                        <div className="font-medium">
                            Periodo
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={accessPeriod === "weekly" ? "default" : "outline"}
                                onClick={() => setAccessPeriod("weekly")}
                            >
                                Última semana
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={accessPeriod === "monthly" ? "default" : "outline"}
                                onClick={() => setAccessPeriod("monthly")}
                            >
                                Último mes
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={accessPeriod === "all" ? "default" : "outline"}
                                onClick={() => setAccessPeriod("all")}
                            >
                                Todo el historial
                            </Button>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setAccessType(null)
                            setAccessPeriod("monthly")
                        }}
                    >
                        Cancelar
                    </Button>
                    <Button type="button" onClick={handleConfirmAccess}>
                        Dar acceso y continuar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    )
}
