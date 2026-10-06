import { NextResponse } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { getSetting } from "@/app/actions/settings"

export async function GET() {
  try {
    if (!(await getCurrentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    const name = (await getSetting("responsible_name")) || ""
    return NextResponse.json({ responsible_name: name })
  } catch (e: unknown) {
    // El detalle va al log; al cliente no se le filtran mensajes internos.
    console.error("[api/settings]", e)
    return NextResponse.json({ error: "settings error" }, { status: 500 })
  }
}
