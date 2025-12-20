import { NextRequest, NextResponse } from "next/server"
import { getSetting, updateSetting } from "@/app/actions/settings"

export async function GET() {
  try {
    const signature = (await getSetting("responsible_signature")) || ""
    return NextResponse.json({ responsible_signature: signature })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "settings error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const signature =
      body && typeof body.responsible_signature === "string" ? body.responsible_signature : ""
    await updateSetting("responsible_signature", signature)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "settings error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

