import { BrandMark } from "@/components/easysecure/brand-mark"

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="animate-pulse">
        <BrandMark size={44} />
      </div>
      <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Cargando…
      </div>
    </div>
  )
}
