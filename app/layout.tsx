import type React from "react"
import type { Metadata } from "next"
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google"
import { Toaster } from "sonner"
import { NavigationProgress } from "@/components/navigation-progress"
import "./globals.css"

// Easysecure typography: Space Grotesk (display), IBM Plex Sans (body), IBM Plex Mono (labels).
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
})
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
})
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Easysecure — Prevención de riesgos, sin papeleo",
    template: "%s · Easysecure",
  },
  description: "Hallazgos, documentación, planos y cumplimiento de cada obra en un solo lugar. Asistido por IA, listo para terreno.",
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
      <body
        className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <NavigationProgress />
        {children}
        <Toaster />
      </body>
    </html>
  )
}
