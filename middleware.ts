import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const publicPaths = [
    "/auth/login",
    "/auth/register",
    "/favicon.ico",
    "/icon.svg",
    "/apple-icon.png",
  ]

  if (publicPaths.includes(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/public")) {
    return NextResponse.next()
  }

  const token = req.cookies.get("session_token")?.value
  if (!token) {
    const url = new URL("/auth/login", req.url)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/(.*)"],
}
