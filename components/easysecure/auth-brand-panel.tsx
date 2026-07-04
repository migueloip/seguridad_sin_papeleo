import { BrandMark } from "@/components/easysecure/brand-mark"

export function AuthBrandPanel() {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-[#16130e] p-16 text-[#f6f4ee] lg:flex">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg,rgba(243,164,10,.07) 0 22px,transparent 22px 44px)",
        }}
      />
      <div className="relative flex items-center gap-3">
        <BrandMark size={40} />
        <span className="font-display text-[22px] font-bold tracking-tight">Easysecure</span>
      </div>
      <div className="relative">
        <div className="mb-5 font-mono text-xs uppercase tracking-[0.18em] text-brand">
          Prevención de riesgos · Sin papeleo
        </div>
        <h1 className="mb-[18px] font-display text-[46px] font-bold leading-[1.04] tracking-[-0.03em]">
          La seguridad
          <br />
          de tu obra,
          <br />
          bajo control.
        </h1>
        <p className="max-w-[420px] text-base leading-relaxed text-[#f6f4ee]/60">
          Hallazgos, documentación, planos y cumplimiento de cada proyecto en un solo lugar.
          Asistido por IA, listo para terreno.
        </p>
      </div>
      <div className="relative flex gap-8">
        {[
          ["142", "días sin accidentes"],
          ["87%", "cumplimiento medio"],
          ["3", "obras activas"],
        ].map(([n, l]) => (
          <div key={l}>
            <div className="font-display text-[26px] font-bold">{n}</div>
            <div className="text-xs text-[#f6f4ee]/50">{l}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
