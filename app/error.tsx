"use client"

import { useEffect } from "react"
import { RotateCcw } from "lucide-react"
import { BrandMark } from "@/components/easysecure/brand-mark"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <BrandMark size={44} />
      <div className="mt-8 font-mono text-xs uppercase tracking-[0.18em] text-danger">
        Algo salió mal
      </div>
      <h1 className="mt-3 font-display text-[34px] font-bold tracking-[-0.02em]">
        Ocurrió un error inesperado
      </h1>
      <p className="mt-2 max-w-[420px] text-[15px] text-muted-foreground">
        Puedes reintentar la operación. Si el problema persiste, revisa tu conexión o vuelve a
        iniciar sesión.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">Código: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-8 flex h-12 items-center gap-2.5 rounded-[11px] bg-primary px-6 text-[15px] font-semibold text-white transition-transform hover:-translate-y-px"
      >
        <RotateCcw className="h-[18px] w-[18px] text-brand" />
        Reintentar
      </button>
    </div>
  )
}
