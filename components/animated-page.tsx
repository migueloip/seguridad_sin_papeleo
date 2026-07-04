"use client"

import { useEffect, useState } from "react"

export function AnimatedPage({ children, duration = 400 }: { children: React.ReactNode; duration?: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 10)
    return () => clearTimeout(t)
  }, [])
  // Solo animamos opacidad: un `transform`/`will-change-transform` aquí crearía un
  // containing block que rompe el `position:fixed` de cajones y modales (se irían con el scroll).
  return (
    <div
      style={{ transition: `opacity ${duration}ms ease` }}
      className={ready ? "opacity-100" : "opacity-0"}
    >
      {children}
    </div>
  )
}
