import { NextRequest, NextResponse } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { getSetting, updateSetting } from "@/app/actions/settings"

export async function GET() {
  try {
    if (!(await getCurrentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    const signature = (await getSetting("responsible_signature")) || ""
    return NextResponse.json({ responsible_signature: signature })
  } catch (e: unknown) {
    // El detalle va al log; al cliente no se le filtran mensajes internos.
    console.error("[api/settings]", e)
    return NextResponse.json({ error: "settings error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await getCurrentUserId())) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    const body = await req.json()
    const signature =
      body && typeof body.responsible_signature === "string" ? body.responsible_signature : ""
    await updateSetting("responsible_signature", signature)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    // El detalle va al log; al cliente no se le filtran mensajes internos.
    console.error("[api/settings]", e)
    return NextResponse.json({ error: "settings error" }, { status: 500 })
  }
}

