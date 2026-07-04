"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"

/**
 * Barra de progreso superior durante la navegación (estilo YouTube).
 * Sustituye a la pantalla completa de carga: la página anterior queda visible
 * y solo se ve esta barra ámbar hasta que llega la nueva.
 */
function ProgressInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [active, setActive] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detecta clics en enlaces internos (el App Router no expone eventos de navegación).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as HTMLElement | null)?.closest?.("a")
      if (!anchor) return
      if (anchor.target && anchor.target !== "_self") return
      if (anchor.hasAttribute("download")) return
      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return
      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      setActive(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      // Failsafe: si la navegación se cancela, ocultar sola.
      timeoutRef.current = setTimeout(() => setActive(false), 12000)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])

  // La ruta cambió → navegación completada.
  useEffect(() => {
    setActive(false)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [pathname, searchParams])

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 90,
        pointerEvents: "none",
        opacity: active ? 1 : 0,
        transition: active ? "opacity 120ms ease" : "opacity 300ms ease 150ms",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "40%",
          borderRadius: 3,
          background: "linear-gradient(90deg, transparent, var(--brand, #f3a40a), var(--brand, #f3a40a))",
          boxShadow: "0 0 10px 1px rgba(243,164,10,.55)",
          animation: active ? "ssp-nav-slide 1.1s ease-in-out infinite" : "none",
        }}
      />
      <style>{`@keyframes ssp-nav-slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`}</style>
    </div>
  )
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <ProgressInner />
    </Suspense>
  )
}
