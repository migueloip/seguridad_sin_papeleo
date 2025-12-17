"use client"

import type React from "react"

import { useState } from "react"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
const SidebarClient = dynamic(() => import("./sidebar").then((m) => m.Sidebar), { ssr: false })
const HeaderClient = dynamic(() => import("./header").then((m) => m.Header), { ssr: false })

interface DashboardLayoutProps {
  children: React.ReactNode
  user?: { email: string; name?: string | null; role?: string | null }
}

export function DashboardLayout({ children, user }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const showSidebar = !pathname.startsWith("/admin") && !pathname.startsWith("/auth")

  return (
    <div className="flex min-h-screen bg-background">
      {showSidebar && (
        <SidebarClient open={sidebarOpen} onClose={() => setSidebarOpen(false)} user={user} />
      )}
      <div className={`flex flex-1 flex-col ${showSidebar ? "lg:pl-72" : ""}`}>
        <HeaderClient onMenuClick={() => setSidebarOpen(true)} user={user} />
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
