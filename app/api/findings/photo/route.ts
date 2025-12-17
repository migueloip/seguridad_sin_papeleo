import { NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const idParam = url.searchParams.get("id")
    const indexParam = url.searchParams.get("index")
    const id = idParam ? Number(idParam) : NaN
    const idx = indexParam ? Number(indexParam) : 0
    if (!Number.isFinite(id) || idx < 0) {
      return new NextResponse("bad request", { status: 400 })
    }
    const userId = await getCurrentUserId()
    if (!userId) {
      return new NextResponse("unauthorized", { status: 401 })
    }
    const rows = await sql<{ photos?: unknown }>`SELECT photos FROM findings WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
    const row = rows[0]
    if (!row || row.photos === null || row.photos === undefined) {
      return new NextResponse("not found", { status: 404 })
    }
    const arr = Array.isArray(row.photos) ? (row.photos as string[]) : []
    const item = arr[idx]
    if (!item) {
      return new NextResponse("not found", { status: 404 })
    }
    if (item.startsWith("data:")) {
      const m = item.match(/^data:([^;]+);base64,(.+)$/)
      if (!m) return new NextResponse("unsupported", { status: 415 })
      const mime = m[1]
      const b64 = m[2]
      const buf = Buffer.from(b64, "base64")
      return new NextResponse(buf, {
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=86400",
        },
      })
    }
    if (item.startsWith("http://") || item.startsWith("https://")) {
      const res = await fetch(item)
      const contentType = res.headers.get("content-type") || "application/octet-stream"
      const arrayBuf = await res.arrayBuffer()
      return new NextResponse(arrayBuf, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      })
    }
    return new NextResponse("unsupported", { status: 415 })
  } catch (e) {
    return new NextResponse("error", { status: 500 })
  }
}
