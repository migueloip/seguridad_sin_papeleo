import { NextResponse } from "next/server"
import { getSetting } from "@/app/actions/settings"

export async function GET() {
  try {
    const tpl = (await getSetting("pdf_template_default")) || ""
    return NextResponse.json({ template: tpl })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "settings error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
