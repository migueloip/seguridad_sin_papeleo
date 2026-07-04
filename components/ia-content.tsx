"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Sparkles, Send, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

const SUGGESTIONS = [
  "¿Cuáles son los hallazgos más urgentes hoy?",
  "Resumen de seguridad de la semana",
  "¿Qué documentos están por vencer?",
  "Zonas de mayor riesgo del proyecto",
]

type ChatPart = { type?: string; text?: string }
type ChatMsg = { parts?: ChatPart[]; content?: string }

function messageText(m: ChatMsg): string {
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p) => p?.type === "text")
      .map((p) => String(p.text || ""))
      .join("")
  }
  return String(m.content || "")
}

export function IaContent() {
  const pathname = usePathname()
  const m = pathname.match(/^\/proyectos\/(\d+)/)
  const projectId = m ? Number(m[1]) : undefined

  const [input, setInput] = useState("")
  const { messages, status, sendMessage, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/assistant" }),
  })
  const isLoading = status === "submitted" || status === "streaming"
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  const submit = (text: string) => {
    const value = text.trim()
    if (!value || isLoading) return
    sendMessage({ text: value }, { body: { projectId } })
    setInput("")
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-3xl flex-col">
      <div className="mb-4">
        <h1 className="font-display text-[27px] font-bold tracking-[-0.02em]">Asistente IA</h1>
        <p className="text-sm text-muted-foreground">
          Pregunta lo que necesites sobre este proyecto: hallazgos, documentos, personal y cumplimiento.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-card">
        <div ref={scrollRef} className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-5">
          <div className="max-w-[80%] rounded-[15px] rounded-bl-[5px] bg-primary px-4 py-3 text-sm leading-relaxed text-sidebar-foreground">
            Hola 👋 Soy tu asistente de Easysecure. Puedo responder sobre hallazgos, documentos y
            vencimientos, personal, planos de riesgo, informes y cumplimiento. ¿Por dónde partimos?
          </div>

          {messages.map((msg) => {
            const isUser = msg.role === "user"
            const text = messageText(msg)
            if (!text) return null
            return (
              <div
                key={msg.id}
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed",
                  isUser
                    ? "self-end rounded-[15px] rounded-br-[5px] bg-secondary text-foreground"
                    : "rounded-[15px] rounded-bl-[5px] bg-primary text-sidebar-foreground",
                )}
              >
                {text}
              </div>
            )
          })}

          {isLoading && (
            <div className="flex items-center gap-2 self-start rounded-[15px] rounded-bl-[5px] bg-primary px-4 py-3 text-sm text-sidebar-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
              <span className="text-sidebar-foreground/80">Pensando…</span>
            </div>
          )}

          {error && (
            <div className="rounded-[15px] bg-danger-tint px-4 py-3 text-sm text-[var(--danger)]">
              No pude conectar con la IA. Revisa que tu API Key de Google AI esté configurada en
              Configuración.
            </div>
          )}

          {messages.length === 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded-[20px] border border-border bg-card px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-secondary"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          className="flex items-center gap-2.5 border-t border-border p-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            submit(input)
          }}
        >
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-secondary">
            <Sparkles className="h-[18px] w-[18px] text-brand" />
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu pregunta…"
            className="h-[44px] flex-1 rounded-[11px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-[11px] bg-primary disabled:opacity-60"
            aria-label="Enviar"
          >
            <Send className="h-[18px] w-[18px] text-brand" />
          </button>
        </form>
      </div>
    </div>
  )
}
