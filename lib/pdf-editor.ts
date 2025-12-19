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

export type PageSize = "A4" | "Letter" | "Legal"

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")

export type DesignerElement =
  | { id: string; type: "heading"; level: 1 | 2 | 3; text: string; align?: "left" | "center" | "right" }
  | { id: string; type: "text"; html: string; align?: "left" | "center" | "right" }
  | { id: string; type: "plain_text"; text: string; align?: "left" | "center" | "right" }
  | {
      id: string
      type: "simple_section"
      title: string
      subtitle?: string | null
      body: string
      bullets?: string[]
      chips?: string[]
      align?: "left" | "center" | "right"
    }
  | { id: string; type: "list"; ordered?: boolean; items: string[]; align?: "left" | "center" | "right" }
  | { id: string; type: "image"; src: string; alt?: string; widthPct?: number }
  | { id: string; type: "table"; rows: string[][] }
  | { id: string; type: "matrix"; rows: MatrixRow[] }
  | { id: string; type: "quote"; item: QuoteItem }
  | { id: string; type: "docs"; items: DocumentAttachment[] }
  | { id: string; type: "divider" }
  | { id: string; type: "page_break" }

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
  designerEnabled?: boolean
  pageSize?: PageSize
  pageMarginMm?: number
  elements?: DesignerElement[]
}

export function validateEditorState(s: EditorState): string[] {
  const alerts: string[] = []
  if (!s.coverTitle.trim()) alerts.push("La portada requiere un título")
  if (!s.summaryText.trim()) alerts.push("El resumen ejecutivo está vacío")
  if (!Array.isArray(s.matrixRows) || s.matrixRows.length === 0) alerts.push("La matriz de hallazgos no tiene filas")
  if (!Array.isArray(s.recs) || s.recs.length === 0) alerts.push("La sección de recomendaciones está vacía")
  if (s.editorSections.includes("docs") && (!Array.isArray(s.docs) || s.docs.length === 0)) alerts.push("La sección de documentos está vacía")
  if (s.editorSections.includes("quotes") && (!Array.isArray(s.quotes) || s.quotes.length === 0)) alerts.push("La sección de citas está vacía")
  if (!s.responsibleName || !s.responsibleName.trim()) alerts.push("Falta el nombre del responsable en el pie de página")
  if (s.designerEnabled && (!Array.isArray(s.elements) || s.elements.length === 0)) alerts.push("El documento no tiene elementos")
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

export function buildDesignerHtmlFromState(s: EditorState): string {
  const size = s.pageSize || "A4"
  const margin = typeof s.pageMarginMm === "number" ? s.pageMarginMm : 20
  const color = s.pdfA ? "#000000" : s.pdfColor
  const styles = `<style>
    body{font-family:${s.pdfFont},system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${color};line-height:1.6}
    .workspace{margin:${margin}mm}
    h1{font-size:${s.pdfFontSize + 8}px;margin:0 0 8px}
    h2{font-size:${s.pdfFontSize + 4}px;margin:16px 0 8px}
    h3{font-size:${s.pdfFontSize + 2}px;margin:12px 0 6px}
    p,li,td,th{font-size:${s.pdfFontSize}px}
    img{max-width:100%;height:auto}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #e5e7eb;padding:8px;text-align:left}
    .footer{position:fixed;bottom:10mm;left:0;right:0;display:flex;justify-content:space-between;font-size:${s.pdfFontSize - 2}px;color:#374151}
    .page-number:after{content:"Página " counter(page) " de " counter(pages)}
    @page{size:${size};margin:${margin}mm}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  </style>`
  const els = (s.elements || []).map((el) => {
    if (el.type === "heading") {
      const tag = el.level === 1 ? "h1" : el.level === 2 ? "h2" : "h3"
      const align = el.align || "left"
      return `<${tag} style="text-align:${align}">${el.text}</${tag}>`
    }
    if (el.type === "text") {
      const align = el.align || "left"
      return `<div style="text-align:${align}">${el.html}</div>`
    }
    if (el.type === "plain_text") {
      const align = el.align || "left"
      return `<div style="text-align:${align};white-space:pre-wrap">${escapeHtml(el.text)}</div>`
    }
    if (el.type === "simple_section") {
      const align = el.align || "left"
      const title = el.title ? `<h2 style="text-align:${align}">${escapeHtml(el.title)}</h2>` : ""
      const subtitle = el.subtitle ? `<p style="text-align:${align};color:#374151">${escapeHtml(el.subtitle)}</p>` : ""
      const body = el.body ? `<div style="text-align:${align};white-space:pre-wrap">${escapeHtml(el.body)}</div>` : ""
      const bullets =
        Array.isArray(el.bullets) && el.bullets.length > 0
          ? `<ul>${el.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
          : ""
      const chips =
        Array.isArray(el.chips) && el.chips.length > 0
          ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0">${el.chips
              .map((c) => `<span style="border:1px solid #e5e7eb;border-radius:9999px;padding:3px 10px;font-size:12px">${escapeHtml(c)}</span>`)
              .join("")}</div>`
          : ""
      return `<section>${title}${subtitle}${chips}${body}${bullets}</section>`
    }
    if (el.type === "list") {
      const align = el.align || "left"
      const tag = el.ordered ? "ol" : "ul"
      const items = (el.items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")
      return `<div style="text-align:${align}"><${tag}>${items}</${tag}></div>`
    }
    if (el.type === "image") {
      const w = el.widthPct && el.widthPct > 0 ? `${Math.min(100, Math.max(10, el.widthPct))}%` : "100%"
      return `<div><img src="${el.src}" alt="${el.alt || ""}" style="width:${w};height:auto"/></div>`
    }
    if (el.type === "table") {
      const body = el.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
        .join("")
      return `<table><tbody>${body}</tbody></table>`
    }
    if (el.type === "matrix") {
      const body = el.rows
        .map(
          (r) =>
            `<tr><td>${r.description}</td><td>${r.category || ""}</td><td>${r.owner || ""}</td><td>${r.severity}</td><td>${r.status}</td><td>${r.date}</td></tr>`,
        )
        .join("")
      return `<section><h2>Matriz de Hallazgos</h2><table><thead><tr><th>Descripción</th><th>Categoría</th><th>Responsable</th><th>Severidad</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>${body}</tbody></table></section>`
    }
    if (el.type === "quote") {
      const q = el.item
      return `<div><p><strong>${q.name}</strong> · ${q.role} · ${q.date}</p><p>${q.content.replace(/\n/g, "<br/>")}</p>${q.signatureDataUrl ? `<img src="${q.signatureDataUrl}" alt="Firma" style="max-height:60px"/>` : ""}</div>`
    }
    if (el.type === "docs") {
      return (el.items || [])
        .map(
          (d) =>
            `<div style="page-break-before:always"><h3>${d.name}</h3><p>Tipo: ${d.type.toUpperCase()}</p>${
              d.previewUrl
                ? `<img src="${d.previewUrl}" alt="Vista previa" style="max-width:100%;height:auto"/>`
                : `<p>Vista previa no disponible</p>`
            }</div>`,
        )
        .join("")
    }
    if (el.type === "divider") {
      return `<hr/>`
    }
    if (el.type === "page_break") {
      return `<div style="page-break-after:always"></div>`
    }
    return ""
  })
  const footer = `
    <div class="footer">
      <div>${new Date().toLocaleDateString("es-CL")}</div>
      <div>${s.responsibleName ? `Responsable: ${s.responsibleName}` : ""}</div>
      <div class="page-number"></div>
    </div>
  `
  const body = `<div class="workspace">${els.join("")}</div>${footer}`
  const meta = s.pdfA ? `<meta name="pdfa" content="true">` : ""
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${s.coverTitle || "Documento"}</title>${meta}${styles}</head><body>${body}</body></html>`
  return html
}
