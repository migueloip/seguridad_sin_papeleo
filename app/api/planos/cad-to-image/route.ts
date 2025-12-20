import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { base64?: string; ext?: string }
    const base64 = typeof body.base64 === "string" ? body.base64.trim() : ""
    const extRaw = typeof body.ext === "string" ? body.ext.trim().toLowerCase() : ""
    if (!base64) {
      return NextResponse.json({ error: "Falta contenido del archivo CAD" }, { status: 400 })
    }
    if (!extRaw || (extRaw !== "dxf" && extRaw !== "dwg")) {
      return NextResponse.json({ error: "Extensión de archivo CAD no soportada" }, { status: 400 })
    }
    const converterUrl = process.env.CAD_CONVERTER_URL
    if (!converterUrl) {
      return NextResponse.json(
        {
          error:
            "No hay conversor CAD configurado. Configura CAD_CONVERTER_URL o exporta el plano como imagen o PDF.",
        },
        { status: 400 },
      )
    }
    const upstream = await fetch(converterUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, ext: extRaw }),
    })
    if (!upstream.ok) {
      let detail = ""
      try {
        const data = (await upstream.json()) as { error?: string; message?: string }
        detail = data.error || data.message || ""
      } catch {}
      const msg = detail
        ? `Error del conversor CAD: ${detail}`
        : "El conversor CAD externo devolvió un error."
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    const data = (await upstream.json()) as { dataUrl?: string; mimeType?: string }
    if (!data || typeof data.dataUrl !== "string" || !data.dataUrl.startsWith("data:")) {
      return NextResponse.json(
        { error: "Respuesta inválida del conversor CAD. Exporta el plano como imagen o PDF." },
        { status: 502 },
      )
    }
    return NextResponse.json({ dataUrl: data.dataUrl, mimeType: data.mimeType || "image/png" })
  } catch (e) {
    return NextResponse.json(
      {
        error: "Error procesando archivo CAD. Exporta el plano como imagen o PDF.",
      },
      { status: 500 },
    )
  }
}

