"use client"

import { useEffect, useState } from "react"

export function AnimatedPage({ children, duration = 400 }: { children: React.ReactNode; duration?: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 10)
    return () => clearTimeout(t)
  }, [])
  return (
    <div
      style={{ transition: `opacity ${duration}ms ease, transform ${duration}ms ease` }}
      className={`${ready ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"} will-change-transform`}
    >
      {children}
    </div>
  )
}
