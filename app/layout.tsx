import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "sonner"
import "./globals.css"

const geist = Geist({ subsets: ["latin"] })
const geistMono = Geist_Mono({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "SafeWork Pro - Seguridad sin Papeleo",
  description: "Plataforma de gestión de Seguridad y Salud Laboral para obras de construcción",
  generator: "v0.app",
  icons: {
    icon: [
      { url: "/logo_safework.png", sizes: "32x32", type: "image/png" },
      { url: "/logo_safework.png", sizes: "96x96", type: "image/png" },
      { url: "/logo_safework.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/logo_safework.png",
    apple: "/logo_safework.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${geist.className} ${geistMono.className} font-sans antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
