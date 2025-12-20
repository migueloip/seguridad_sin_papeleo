import { NextResponse } from "next/server"

export async function GET() {
  const clientId = process.env.AUTODESK_CLIENT_ID
  const clientSecret = process.env.AUTODESK_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error: "Falta configuración de Autodesk. Define AUTODESK_CLIENT_ID y AUTODESK_CLIENT_SECRET.",
      },
      { status: 500 },
    )
  }

  const params = new URLSearchParams()
  params.set("grant_type", "client_credentials")
  params.set("client_id", clientId)
  params.set("client_secret", clientSecret)
  params.set("scope", "data:read data:write bucket:read bucket:create")

  try {
    const res = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: "No se pudo obtener el token de Autodesk." },
        { status: 500 },
      )
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!data.access_token) {
      return NextResponse.json(
        { error: "Respuesta de Autodesk sin token de acceso." },
        { status: 500 },
      )
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: "Error de red al obtener token de Autodesk." },
      { status: 500 },
    )
  }
}

