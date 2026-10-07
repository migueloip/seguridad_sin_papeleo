"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Sparkles, X, Send, Loader2 } from "lucide-react"
import { chatErrorMessage } from "@/lib/ai-chat-errors"
import { cn } from "@/lib/utils"

const SUGGESTIONS = [
  "¿Cuáles son los hallazgos más urgentes hoy?",
  "Resumen de la semana",
  "¿Qué documentos están por vencer?",
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

export function AiAssistantDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  }, [messages, open])

  const submit = (text: string) => {
    const value = text.trim()
    if (!value || isLoading) return
    sendMessage({ text: value }, { body: { projectId } })
    setInput("")
  }

  // El componente permanece montado (conserva el historial); solo ocultamos el panel.
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[rgba(10,8,5,0.4)]" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-screen w-full max-w-[400px] flex-col border-l border-border bg-card shadow-[-12px_0_40px_-20px_rgba(20,18,15,0.4)]">
        {/* Header */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-[18px]">
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-primary">
            <Sparkles className="h-[18px] w-[18px] text-brand" />
          </span>
          <div className="flex-1">
            <div className="font-display text-[15px] font-semibold">Asistente IA</div>
            <div className="text-xs text-muted-foreground">Pregunta sobre tu proyecto</div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground/70 hover:bg-muted"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mensajes */}
        <div ref={scrollRef} className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-[18px]">
          <div className="max-w-[90%] rounded-[14px] rounded-bl-[4px] bg-primary px-4 py-3 text-sm leading-relaxed text-sidebar-foreground">
            Hola 👋 Soy tu asistente de Easysecure. Puedo responder sobre este proyecto: hallazgos,
            documentos y vencimientos, personal, planos de riesgo, informes y cumplimiento. ¿Por dónde
            partimos?
          </div>

          {messages.map((msg) => {
            const isUser = msg.role === "user"
            const text = messageText(msg)
            if (!text) return null
            return (
              <div
                key={msg.id}
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed",
                  isUser
                    ? "self-end rounded-[14px] rounded-br-[4px] bg-secondary text-foreground"
                    : "rounded-[14px] rounded-bl-[4px] bg-primary text-sidebar-foreground",
                )}
              >
                {text}
              </div>
            )
          })}

          {isLoading && (
            <div className="flex items-center gap-2 self-start rounded-[14px] rounded-bl-[4px] bg-primary px-4 py-3 text-sm text-sidebar-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
              <span className="text-sidebar-foreground/80">Pensando…</span>
            </div>
          )}

          {error && (
            <div className="rounded-[14px] bg-danger-tint px-4 py-3 text-sm text-[var(--danger)]">
              {chatErrorMessage(error)}
            </div>
          )}

          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded-[20px] border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <form
          className="flex items-center gap-2.5 border-t border-border p-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            submit(input)
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu pregunta…"
            className="h-[42px] flex-1 rounded-[11px] border border-border bg-card px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-[11px] bg-primary disabled:opacity-60"
            aria-label="Enviar"
          >
            <Send className="h-[18px] w-[18px] text-brand" />
          </button>
        </form>
      </div>
    </div>
  )
}
