import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const PUBLIC_PATHS = ["/auth/login", "/auth/register", "/favicon.ico", "/icon.svg", "/apple-icon.png"]

// Extensiones de assets estáticos que sirve /public/ y deben pasar sin auth.
// Si auth bloquea estas peticiones, Next.js Image recibe el HTML del redirect
// en vez del binario y reporta "isn't a valid image / received null".
const STATIC_ASSET_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|glb|gltf|bin|mp3|wav|ogg|woff2?|ttf|otf|eot|css|js|json|map|txt|wasm)$/i

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (
    PUBLIC_PATHS.includes(pathname) ||
    STATIC_ASSET_RE.test(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/mobile") ||
    pathname.startsWith("/api/diagnostics") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/admin")
  ) {
    return NextResponse.next()
  }

  const token = req.cookies.get("session_token")?.value
  if (!token) {
    const url = new URL("/auth/login", req.url)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = { matcher: ["/(.*)"] }
