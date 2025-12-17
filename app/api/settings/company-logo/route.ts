import { NextResponse } from "next/server"
import { getSetting } from "@/app/actions/settings"

export async function GET() {
  try {
    const logo = (await getSetting("company_logo")) || ""
    return NextResponse.json({ company_logo: logo })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "settings error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
