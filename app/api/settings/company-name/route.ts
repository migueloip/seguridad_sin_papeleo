import { NextResponse } from "next/server"
import { getSetting } from "@/app/actions/settings"

export async function GET() {
  const name = await getSetting("company_name")
  return NextResponse.json({ company_name: name })
}

