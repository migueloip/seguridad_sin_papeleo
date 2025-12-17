export type Severity = "alta" | "medio" | "bajo"
export type Status = "pendiente" | "en progreso" | "resuelto"

export type MatrixRow = {
  description: string
  severity: Severity
  status: Status
  date: string
  category?: string | null
  owner?: string | null
}

export type DocumentAttachment = {
  name: string
  type: "pdf" | "word" | "excel" | "other"
  previewUrl?: string | null
}

export type QuoteItem = {
  name: string
  role: string
  date: string
  content: string
  signatureDataUrl?: string | null
}

export type EditorState = {
  pdfFont: "sans-serif" | "serif"
  pdfFontSize: number
  pdfColor: string
  editorSections: Array<"cover" | "summary" | "matrix" | "docs" | "quotes" | "recs">
  coverTitle: string
  coverSubtitle: string
  summaryText: string
  matrixRows: MatrixRow[]
  recs: string[]
  brandLogo?: string | null
  responsibleName?: string | null
  pdfA?: boolean
  docs?: DocumentAttachment[]
  quotes?: QuoteItem[]
}

export function validateEditorState(s: EditorState): string[] {
  const alerts: string[] = []
  if (!s.coverTitle.trim()) alerts.push("La portada requiere un título")
  if (!s.summaryText.trim()) alerts.push("El resumen ejecutivo está vacío")
  if (!Array.isArray(s.matrixRows) || s.matrixRows.length === 0) alerts.push("La matriz de hallazgos no tiene filas")
  if (!Array.isArray(s.recs) || s.recs.length === 0) alerts.push("La sección de recomendaciones está vacía")
  return alerts
}

export function buildEditorHtmlFromState(s: EditorState): string {
  const color = s.pdfA ? "#000000" : s.pdfColor
  const styles = `<style>
    body{font-family:${s.pdfFont},system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:20mm;color:${color};line-height:1.6}
    h1{font-size:${s.pdfFontSize + 8}px;margin:0 0 8px}
    h2{font-size:${s.pdfFontSize + 4}px;margin:16px 0 8px}
    h3{font-size:${s.pdfFontSize + 2}px;margin:12px 0 6px}
    p,li,td,th{font-size:${s.pdfFontSize}px}
    .cover{display:flex;flex-direction:column;justify-content:center;align-items:center;height:80vh;text-align:center}
    .cover img{max-height:100px;margin-bottom:16px}
    .matrix{width:100%;border-collapse:collapse}
    .matrix th,.matrix td{border:1px solid #e5e7eb;padding:8px;text-align:left}
    .doc-page{page-break-before:always}
    .footer{position:fixed;bottom:10mm;left:0;right:0;display:flex;justify-content:space-between;font-size:${s.pdfFontSize - 2}px;color:#374151}
    .page-number:after{content:"Página " counter(page) " de " counter(pages)}
    @page{size:A4;margin:20mm}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  </style>`
  const cover = `
    <section class="cover">
      ${s.brandLogo ? `<img src="${s.brandLogo}" alt="Logo"/>` : ""}
      <h1>${s.coverTitle}</h1>
      <p>${s.coverSubtitle}</p>
    </section>
    <div style="page-break-after:always"></div>
  `
  const summary = `
    <section>
      <h2>Resumen Ejecutivo</h2>
      <p>${s.summaryText.replace(/\n/g, "<br/>")}</p>
    </section>
  `
  const matrix = `
    <section>
      <h2>Matriz de Hallazgos</h2>
      <table class="matrix">
        <thead>
          <tr>
            <th>Descripción</th><th>Categoría</th><th>Responsable</th><th>Severidad</th><th>Estado</th><th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          ${s.matrixRows
            .map(
              (r) =>
                `<tr><td>${r.description}</td><td>${r.category || ""}</td><td>${r.owner || ""}</td><td>${r.severity}</td><td>${r.status}</td><td>${r.date}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `
  const docs =
    (s.docs || []).length > 0
      ? `
    <section>
      <h2>Documentos Adjuntos</h2>
      ${(s.docs || [])
        .map(
          (d) =>
            `<div class="doc-page">
              <h3>${d.name}</h3>
              <p>Tipo: ${d.type.toUpperCase()}</p>
              ${
                d.previewUrl
                  ? `<img src="${d.previewUrl}" alt="Vista previa" style="max-width:100%;height:auto"/>`
                  : `<p>Vista previa no disponible</p>`
              }
            </div>`,
        )
        .join("")}
    </section>
  `
      : ""
  const quotes =
    (s.quotes || []).length > 0
      ? `
    <section>
      <h2>Citas de Personal</h2>
      ${(s.quotes || [])
        .map(
          (q) =>
            `<div style="margin-bottom:12px">
              <p><strong>${q.name}</strong> · ${q.role} · ${q.date}</p>
              <p>${q.content.replace(/\n/g, "<br/>")}</p>
              ${q.signatureDataUrl ? `<img src="${q.signatureDataUrl}" alt="Firma" style="max-height:60px"/>` : ""}
            </div>`,
        )
        .join("")}
    </section>
  `
      : ""
  const recsHtml = `
    <section>
      <h2>Recomendaciones</h2>
      <ol>${s.recs.map((i) => `<li>${i}</li>`).join("")}</ol>
    </section>
  `
  const footer = `
    <div class="footer">
      <div>${new Date().toLocaleDateString("es-CL")}</div>
      <div>${s.responsibleName ? `Responsable: ${s.responsibleName}` : ""}</div>
      <div class="page-number"></div>
    </div>
  `
  const secMap: Record<string, string> = { cover, summary, matrix, recs: recsHtml, docs, quotes }
  const body = s.editorSections.map((k) => secMap[k]).join("") + footer
  const meta = s.pdfA ? `<meta name="pdfa" content="true">` : ""
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${s.coverTitle}</title>${meta}${styles}</head><body>${body}</body></html>`
  return html
}
