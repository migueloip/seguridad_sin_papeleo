import { NextResponse } from "next/server"
import { getSetting } from "@/app/actions/settings"

export async function GET() {
  try {
    const name = (await getSetting("responsible_name")) || ""
    return NextResponse.json({ responsible_name: name })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "settings error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
