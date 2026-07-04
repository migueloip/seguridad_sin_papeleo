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
  | { id: string; type: "kpis"; items: { label: string; value: string }[] }
  | { id: string; type: "toc"; title?: string }
  | { id: string; type: "chart"; title?: string; bars: { label: string; value: number; color?: string }[] }
  | { id: string; type: "cover"; title: string; subtitle?: string; meta?: string }
  | {
      id: string
      type: "signers"
      signers: { name: string; role: string; status: "pendiente" | "firmado"; signatureDataUrl?: string | null }[]
    }
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
  responsibleSignatureDataUrl?: string | null
  pdfA?: boolean
  docs?: DocumentAttachment[]
  quotes?: QuoteItem[]
  designerEnabled?: boolean
  pageSize?: PageSize
  pageMarginMm?: number
  elements?: DesignerElement[]
  numberSections?: boolean
}

export function validateEditorState(s: EditorState): string[] {
  const alerts: string[] = []
  if (!s.coverTitle.trim()) alerts.push("La portada requiere un título")
  if (!s.responsibleName || !s.responsibleName.trim()) alerts.push("Falta el nombre del responsable en el pie de página")
  if (s.designerEnabled) {
    if (!Array.isArray(s.elements) || s.elements.length === 0) alerts.push("El documento no tiene elementos")
    return alerts
  }
  if (!s.summaryText.trim()) alerts.push("El resumen ejecutivo está vacío")
  if (!Array.isArray(s.matrixRows) || s.matrixRows.length === 0) alerts.push("La matriz de hallazgos no tiene filas")
  if (!Array.isArray(s.recs) || s.recs.length === 0) alerts.push("La sección de recomendaciones está vacía")
  if (s.editorSections.includes("docs") && (!Array.isArray(s.docs) || s.docs.length === 0)) alerts.push("La sección de documentos está vacía")
  if (s.editorSections.includes("quotes") && (!Array.isArray(s.quotes) || s.quotes.length === 0)) alerts.push("La sección de citas está vacía")
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
    .signature-block{margin-top:24px;margin-bottom:28mm}
    .signature-row{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
    .signature-img{max-height:80px;max-width:260px}
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
  const signature =
    s.responsibleSignatureDataUrl && String(s.responsibleSignatureDataUrl).startsWith("data:")
      ? `
    <section class="signature-block">
      <h2>Firma del Prevencionista de Riesgo</h2>
      <div class="signature-row">
        <div>${s.responsibleName ? escapeHtml(s.responsibleName) : ""}</div>
        <div><img class="signature-img" src="${s.responsibleSignatureDataUrl}" alt="Firma prevencionista"/></div>
      </div>
    </section>
  `
      : ""
  const footer = `
    <div class="footer">
      <div>${new Date().toLocaleDateString("es-CL")}</div>
      <div>${s.responsibleName ? `Responsable: ${s.responsibleName}` : ""}</div>
      <div class="page-number"></div>
    </div>
  `
  const secMap: Record<string, string> = { cover, summary, matrix, recs: recsHtml, docs, quotes }
  const body = s.editorSections.map((k) => secMap[k]).join("") + signature + footer
  const meta = s.pdfA ? `<meta name="pdfa" content="true">` : ""
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${s.coverTitle}</title>${meta}${styles}</head><body>${body}</body></html>`
  return html
}

export function buildDesignerHtmlFromState(s: EditorState): string {
  const size = s.pageSize || "A4"
  const margin = typeof s.pageMarginMm === "number" ? s.pageMarginMm : 20
  const fs = s.pdfFontSize || 14
  // Paleta Easysecure (igual que la app) aplicada al PDF.
  const INK = "#16130e"
  const CREAM = "#f6f4ee"
  const AMBER = "#f3a40a"
  const BORDER = "#e7e2d7"
  const MUTED = "#8a8378"
  const TEXT = s.pdfA ? "#000000" : "#26221c"
  const sevColor: Record<string, string> = { alta: "#d8443a", medio: "#b8841a", bajo: "#6f6a60" }
  const stColor: Record<string, string> = { pendiente: "#e8960b", "en progreso": "#e8960b", resuelto: "#1f9d68" }
  const cap = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : "")

  const styles = `<style>
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
    body{font-family:${s.pdfFont},'Helvetica Neue',Arial,sans-serif;color:${TEXT};line-height:1.6;margin:0}
    .workspace{margin:${margin}mm}
    p,li,td,th{font-size:${fs}px}
    img{max-width:100%;height:auto}
    .ez-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${INK};padding-bottom:13px;margin-bottom:20px}
    .ez-brand{display:flex;align-items:center;gap:10px}
    .ez-logo{width:34px;height:34px;border-radius:8px;background:${INK};display:flex;align-items:center;justify-content:center;overflow:hidden}
    .ez-logo img{max-width:100%;max-height:100%}
    .ez-brand-name{font-weight:700;font-size:${fs + 3}px;letter-spacing:-.01em}
    .ez-brand-sub{font-size:${fs - 3}px;color:${MUTED}}
    .ez-meta{text-align:right;font-size:${fs - 3}px;color:${MUTED};font-family:'IBM Plex Mono',ui-monospace,monospace}
    h1{font-family:Georgia,'Times New Roman',serif;font-size:${fs + 9}px;text-align:center;margin:4px 0 16px;font-weight:700}
    h2{font-size:${fs + 3}px;margin:16px 0 8px}
    h3{font-size:${fs + 1}px;margin:12px 0 6px}
    .ez-sec{margin:0 0 16px}
    .ez-sec-bar{background:${INK};color:${CREAM};font-weight:700;font-size:${fs}px;padding:8px 14px;border-radius:9px 9px 0 0}
    .ez-sec-body{border:1px solid ${BORDER};border-top:none;border-radius:0 0 9px 9px;padding:12px 14px}
    .ez-sec-body p{margin:0 0 6px}
    .ez-chip{display:inline-block;border:1px solid ${BORDER};border-radius:9999px;padding:2px 10px;font-size:${fs - 3}px;margin:0 4px 4px 0}
    table.ez-table{border-collapse:collapse;width:100%;margin:0 0 16px;border:1px solid ${BORDER};border-radius:9px;overflow:hidden}
    table.ez-table th{background:${INK};color:${CREAM};text-align:left;padding:9px 12px;font-size:${fs - 2}px;font-weight:600}
    table.ez-table td{border-top:1px solid ${BORDER};padding:8px 12px;font-size:${fs - 1}px}
    table.ez-fields{border-collapse:collapse;width:100%;margin:0 0 16px;border:1px solid ${BORDER};border-radius:9px;overflow:hidden}
    table.ez-fields td{border:1px solid ${BORDER};padding:8px 12px;font-size:${fs - 1}px}
    table.ez-fields td.k{background:${CREAM};color:${MUTED};font-weight:600;width:30%}
    .ez-sign-row{display:flex;justify-content:space-around;gap:24px;margin-top:18px}
    .ez-sign{flex:1;text-align:center}
    .ez-sign-img{max-height:54px;margin-bottom:4px}
    .ez-sign-pending{font-size:${fs - 3}px;color:${MUTED};font-style:italic;margin-bottom:6px}
    .ez-sign-line{border-top:1px solid ${INK};margin:0 8px 6px}
    .ez-sign-name{font-weight:700;font-size:${fs - 1}px}
    .ez-sign-role{font-size:${fs - 3}px;color:${MUTED}}
    .ez-kpis{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 16px}
    .ez-kpi{flex:1;min-width:120px;border:1px solid ${BORDER};border-radius:10px;padding:11px 13px}
    .ez-kpi-val{font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:${fs + 7}px;color:${INK}}
    .ez-kpi-lbl{font-size:${fs - 3}px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
    .ez-toc ol{margin:0;padding-left:18px}
    .ez-toc li{margin:3px 0}
    .ez-chart{margin:0 0 16px;border:1px solid ${BORDER};border-radius:10px;padding:14px}
    .ez-chart-title{font-weight:700;font-size:${fs}px;margin:0 0 10px}
    .ez-bars{display:flex;align-items:flex-end;gap:14px;height:150px;padding-top:8px}
    .ez-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
    .ez-bar{width:100%;max-width:54px;border-radius:6px 6px 0 0;min-height:2px}
    .ez-bar-val{font-weight:700;font-size:${fs - 2}px;margin-bottom:4px}
    .ez-bar-lbl{font-size:${fs - 3}px;color:${MUTED};margin-top:6px;text-align:center}
    .ez-cover{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:78vh;page-break-after:always}
    .ez-cover .ez-logo{width:56px;height:56px;margin-bottom:20px}
    .ez-cover-title{font-family:Georgia,'Times New Roman',serif;font-size:${fs + 18}px;font-weight:700;margin:0 0 10px;max-width:80%}
    .ez-cover-sub{font-size:${fs + 1}px;color:${MUTED};margin:0 0 26px}
    .ez-cover-meta{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:${fs - 2}px;color:${MUTED};border-top:1px solid ${BORDER};padding-top:14px}
    .ez-status{display:inline-block;border-radius:9999px;padding:2px 10px;font-size:${fs - 4}px;font-weight:700}
    .ez-status.pendiente{background:${"#fbf0d9"};color:${"#e8960b"}}
    .ez-status.firmado{background:${"#e6f4ec"};color:${"#1f9d68"}}
    @media print{.ez-pagefoot{position:fixed;bottom:6mm;right:0;font-size:${fs - 5}px;color:${MUTED};font-family:'IBM Plex Mono',ui-monospace,monospace}.ez-pagefoot:after{content:"Página " counter(page)}}
    @media print{
      .ez-sec,.ez-kpis,.ez-chart,.ez-sign-row,.ez-cover,blockquote,figure{break-inside:avoid;page-break-inside:avoid}
      table.ez-table tr,table.ez-fields tr{break-inside:avoid;page-break-inside:avoid}
      table.ez-table thead{display:table-header-group}
      h1,h2,h3,.ez-sec-bar{break-after:avoid;page-break-after:avoid}
      [data-ssp-el-id]:hover{outline:none}
    }
    [data-ssp-el-id]{cursor:pointer}
    [data-ssp-el-id]:hover{outline:1.5px dashed ${AMBER};outline-offset:3px;border-radius:8px}
    .ez-drop-before{box-shadow:0 -3px 0 0 ${AMBER} !important}
    .ez-drop-after{box-shadow:0 3px 0 0 ${AMBER} !important}
    .ez-dragging{opacity:.35}
    hr{border:none;border-top:1px solid ${BORDER};margin:14px 0}
    .ez-footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid ${BORDER};margin-top:22px;padding-top:10px;font-size:${fs - 4}px;color:${MUTED};font-family:'IBM Plex Mono',ui-monospace,monospace}
    @page{size:${size};margin:${margin}mm}
  </style>`

  const logoInner =
    s.brandLogo && String(s.brandLogo).startsWith("data:")
      ? `<img src="${s.brandLogo}" alt="logo"/>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l8 3v6c0 5-3.4 8.4-8 11-4.6-2.6-8-6-8-11V5l8-3z" fill="${AMBER}"/></svg>`
  const header = `
    <header class="ez-header">
      <div class="ez-brand">
        <div class="ez-logo">${logoInner}</div>
        <div>
          <div class="ez-brand-name">Easysecure</div>
          <div class="ez-brand-sub">${s.coverSubtitle ? escapeHtml(s.coverSubtitle) : "Prevención de riesgos"}</div>
        </div>
      </div>
      <div class="ez-meta">
        ${s.coverSubtitle ? `<div>${escapeHtml(s.coverSubtitle)}</div>` : ""}
        <div>Sistema de Gestión SST</div>
      </div>
    </header>`

  let secNum = 0
  const els = (s.elements || []).map((el) => {
    if (el.type === "heading") {
      const tag = el.level === 1 ? "h1" : el.level === 2 ? "h2" : "h3"
      const align = el.align || (el.level === 1 ? "center" : "left")
      return `<${tag} data-ssp-el-id="${el.id}" data-edit="heading" style="text-align:${align}">${escapeHtml(el.text)}</${tag}>`
    }
    if (el.type === "text") {
      const align = el.align || "left"
      return `<div data-ssp-el-id="${el.id}" style="text-align:${align}">${el.html}</div>`
    }
    if (el.type === "plain_text") {
      const align = el.align || "left"
      const muted = align === "center" ? `color:${MUTED};` : ""
      return `<div data-ssp-el-id="${el.id}" data-edit="text" style="text-align:${align};${muted}white-space:pre-wrap;margin:0 0 12px">${escapeHtml(el.text)}</div>`
    }
    if (el.type === "simple_section") {
      const num = s.numberSections && el.title ? `${(secNum += 1)}. ` : ""
      const title = el.title ? `<div class="ez-sec-bar" data-edit="stitle">${num}${escapeHtml(el.title)}</div>` : ""
      const subtitle = el.subtitle ? `<p style="color:${MUTED}">${escapeHtml(el.subtitle)}</p>` : ""
      const body = el.body ? `<div data-edit="sbody" style="white-space:pre-wrap">${escapeHtml(el.body)}</div>` : ""
      const bullets =
        Array.isArray(el.bullets) && el.bullets.length > 0
          ? `<ul style="margin:8px 0 0;padding-left:18px">${el.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
          : ""
      const chips =
        Array.isArray(el.chips) && el.chips.length > 0
          ? `<div style="margin:8px 0 0">${el.chips.map((c) => `<span class="ez-chip">${escapeHtml(c)}</span>`).join("")}</div>`
          : ""
      const inner = `${subtitle}${chips}${body}${bullets}`
      return `<section class="ez-sec" data-ssp-el-id="${el.id}">${title}<div class="ez-sec-body">${inner || "&nbsp;"}</div></section>`
    }
    if (el.type === "list") {
      const align = el.align || "left"
      const tag = el.ordered ? "ol" : "ul"
      const items = (el.items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")
      return `<div data-ssp-el-id="${el.id}" style="text-align:${align};margin:0 0 14px"><${tag} data-edit="list" style="padding-left:18px">${items}</${tag}></div>`
    }
    if (el.type === "image") {
      const w = el.widthPct && el.widthPct > 0 ? `${Math.min(100, Math.max(10, el.widthPct))}%` : "100%"
      return `<div data-ssp-el-id="${el.id}" style="margin:0 0 14px"><img src="${el.src}" alt="${el.alt || ""}" style="width:${w};height:auto"/></div>`
    }
    if (el.type === "table") {
      const isFields = el.rows.every((r) => r.length === 2)
      if (isFields) {
        const body = el.rows
          .map(
            (r, ri) =>
              `<tr><td class="k" data-edit="cell" data-r="${ri}" data-c="0">${escapeHtml(r[0] ?? "")}</td><td data-edit="cell" data-r="${ri}" data-c="1">${escapeHtml(
                r[1] ?? "",
              )}</td></tr>`,
          )
          .join("")
        return `<table class="ez-fields" data-ssp-el-id="${el.id}"><tbody>${body}</tbody></table>`
      }
      const [head, ...rest] = el.rows
      const thead = head
        ? `<thead><tr>${head.map((c, ci) => `<th data-edit="cell" data-r="0" data-c="${ci}">${escapeHtml(c)}</th>`).join("")}</tr></thead>`
        : ""
      const tbody = rest
        .map(
          (row, i) =>
            `<tr>${row.map((cell, ci) => `<td data-edit="cell" data-r="${i + 1}" data-c="${ci}">${escapeHtml(cell)}</td>`).join("")}</tr>`,
        )
        .join("")
      return `<table class="ez-table" data-ssp-el-id="${el.id}">${thead}<tbody>${tbody}</tbody></table>`
    }
    if (el.type === "matrix") {
      const body = el.rows
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.description)}</td><td>${escapeHtml(r.category || "")}</td><td>${escapeHtml(
              r.owner || "",
            )}</td><td style="color:${sevColor[r.severity] || TEXT};font-weight:600">${cap(r.severity)}</td><td style="color:${
              stColor[r.status] || TEXT
            };font-weight:600">${cap(r.status)}</td><td>${escapeHtml(r.date)}</td></tr>`,
        )
        .join("")
      return `<section class="ez-sec" data-ssp-el-id="${el.id}"><div class="ez-sec-bar">Matriz de Hallazgos</div><div class="ez-sec-body" style="padding:0"><table class="ez-table" style="border:none;border-radius:0;margin:0"><thead><tr><th>Descripción</th><th>Categoría</th><th>Responsable</th><th>Severidad</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>${body}</tbody></table></div></section>`
    }
    if (el.type === "quote") {
      const q = el.item
      const sig = q.signatureDataUrl
        ? `<img class="ez-sign-img" src="${q.signatureDataUrl}" alt="Firma"/>`
        : `<div class="ez-sign-pending">Pendiente de firma</div>`
      const note = q.content ? `<p style="color:${MUTED};font-size:${fs - 2}px;margin:0 0 8px">${escapeHtml(q.content)}</p>` : ""
      return `<div class="ez-sec" data-ssp-el-id="${el.id}">${note}<div class="ez-sign-row"><div class="ez-sign">${sig}<div class="ez-sign-line"></div><div class="ez-sign-name" data-edit="qname">${escapeHtml(
        q.name,
      )}</div><div class="ez-sign-role">${escapeHtml(q.role)}${q.date ? ` · ${escapeHtml(q.date)}` : ""}</div></div></div></div>`
    }
    if (el.type === "kpis") {
      const cards = (el.items || [])
        .map(
          (k, i) =>
            `<div class="ez-kpi"><div class="ez-kpi-val" data-edit="kpi" data-r="${i}" data-c="value">${escapeHtml(
              k.value,
            )}</div><div class="ez-kpi-lbl" data-edit="kpi" data-r="${i}" data-c="label">${escapeHtml(k.label)}</div></div>`,
        )
        .join("")
      return `<div class="ez-kpis" data-ssp-el-id="${el.id}">${cards}</div>`
    }
    if (el.type === "toc") {
      const entries = (s.elements || [])
        .filter((e) => (e.type === "heading" && e.level <= 2) || e.type === "simple_section")
        .map((e) => (e.type === "heading" ? e.text : e.type === "simple_section" ? e.title : ""))
        .filter((t) => t && t.trim().length > 0)
      const items = entries.map((t) => `<li>${escapeHtml(t)}</li>`).join("")
      return `<section class="ez-sec ez-toc" data-ssp-el-id="${el.id}"><div class="ez-sec-bar">${escapeHtml(
        el.title || "Tabla de contenido",
      )}</div><div class="ez-sec-body"><ol>${items || "<li>(sin secciones)</li>"}</ol></div></section>`
    }
    if (el.type === "chart") {
      const palette = ["#d8443a", "#e8960b", "#b8841a", "#1f9d68", "#3b6fd4", "#7c4dd4"]
      const max = Math.max(1, ...el.bars.map((b) => (Number.isFinite(b.value) ? b.value : 0)))
      const cols = el.bars
        .map((b, i) => {
          const h = Math.max(2, Math.round(((Number.isFinite(b.value) ? b.value : 0) / max) * 120))
          const col = b.color || palette[i % palette.length]
          return `<div class="ez-bar-col"><div class="ez-bar-val">${escapeHtml(String(b.value))}</div><div class="ez-bar" style="height:${h}px;background:${col}"></div><div class="ez-bar-lbl">${escapeHtml(
            b.label,
          )}</div></div>`
        })
        .join("")
      return `<div class="ez-chart" data-ssp-el-id="${el.id}">${
        el.title ? `<div class="ez-chart-title">${escapeHtml(el.title)}</div>` : ""
      }<div class="ez-bars">${cols}</div></div>`
    }
    if (el.type === "cover") {
      return `<section class="ez-cover" data-ssp-el-id="${el.id}"><div class="ez-logo">${logoInner}</div><div class="ez-cover-title" data-edit="ctitle">${escapeHtml(
        el.title,
      )}</div>${el.subtitle ? `<div class="ez-cover-sub" data-edit="csub">${escapeHtml(el.subtitle)}</div>` : ""}${
        el.meta ? `<div class="ez-cover-meta">${escapeHtml(el.meta)}</div>` : ""
      }</section>`
    }
    if (el.type === "signers") {
      const cols = (el.signers || [])
        .map((sg) => {
          const top = sg.signatureDataUrl
            ? `<img class="ez-sign-img" src="${sg.signatureDataUrl}" alt="Firma"/>`
            : `<div class="ez-sign-pending">${sg.status === "firmado" ? "Firmado" : "Pendiente de firma"}</div>`
          return `<div class="ez-sign">${top}<div class="ez-sign-line"></div><div class="ez-sign-name">${escapeHtml(
            sg.name,
          )}</div><div class="ez-sign-role">${escapeHtml(sg.role)}</div><div style="margin-top:5px"><span class="ez-status ${
            sg.status === "firmado" ? "firmado" : "pendiente"
          }">${sg.status === "firmado" ? "Firmado" : "Pendiente"}</span></div></div>`
        })
        .join("")
      return `<section class="ez-sec" data-ssp-el-id="${el.id}"><div class="ez-sign-row">${cols}</div></section>`
    }
    if (el.type === "docs") {
      return (el.items || [])
        .map(
          (d) =>
            `<div data-ssp-el-id="${el.id}" style="page-break-before:always"><h3>${escapeHtml(d.name)}</h3><p>Tipo: ${d.type.toUpperCase()}</p>${
              d.previewUrl
                ? `<img src="${d.previewUrl}" alt="Vista previa" style="max-width:100%;height:auto"/>`
                : `<p>Vista previa no disponible</p>`
            }</div>`,
        )
        .join("")
    }
    if (el.type === "divider") {
      return `<hr data-ssp-el-id="${el.id}"/>`
    }
    if (el.type === "page_break") {
      return `<div data-ssp-el-id="${el.id}" style="page-break-after:always"></div>`
    }
    return ""
  })

  const signature =
    s.responsibleSignatureDataUrl && String(s.responsibleSignatureDataUrl).startsWith("data:")
      ? `<div class="ez-sign-row"><div class="ez-sign"><img class="ez-sign-img" src="${s.responsibleSignatureDataUrl}" alt="Firma"/><div class="ez-sign-line"></div><div class="ez-sign-name">${
          s.responsibleName ? escapeHtml(s.responsibleName) : ""
        }</div><div class="ez-sign-role">Prevencionista de Riesgos</div></div></div>`
      : ""
  const footer = `<div class="ez-footer"><div>${new Date().toLocaleDateString("es-CL")}</div><div>Easysecure${
    s.responsibleName ? ` · ${escapeHtml(s.responsibleName)}` : ""
  }</div></div>`

  const script = `<script>(function(){try{
    document.addEventListener('click',function(ev){if(document.querySelector('[contenteditable="true"]'))return;var el=ev.target;while(el&&el!==document.body){if(el.dataset&&el.dataset.sspElId){parent.postMessage({type:'REPORT_DESIGNER_SELECT',elementId:el.dataset.sspElId},'*');break;}el=el.parentElement;}},true);
    var blocks=document.querySelectorAll('[data-ssp-el-id]');for(var i=0;i<blocks.length;i++){blocks[i].setAttribute('draggable','true');}
    var dragId=null;var findBlock=function(n){while(n&&n!==document.body){if(n.dataset&&n.dataset.sspElId)return n;n=n.parentElement;}return null;};
    var clearDrop=function(){var m=document.querySelectorAll('.ez-drop-before,.ez-drop-after');for(var i=0;i<m.length;i++){m[i].classList.remove('ez-drop-before');m[i].classList.remove('ez-drop-after');}};
    document.addEventListener('dragstart',function(ev){if(document.querySelector('[contenteditable="true"]')){ev.preventDefault();return;}var el=findBlock(ev.target);if(!el){ev.preventDefault();return;}dragId=el.dataset.sspElId;el.classList.add('ez-dragging');try{ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('text/plain',dragId);}catch(e){}});
    document.addEventListener('dragover',function(ev){if(!dragId)return;ev.preventDefault();ev.dataTransfer.dropEffect='move';var el=findBlock(ev.target);clearDrop();if(!el||el.dataset.sspElId===dragId)return;var r=el.getBoundingClientRect();el.classList.add(ev.clientY<r.top+r.height/2?'ez-drop-before':'ez-drop-after');});
    document.addEventListener('drop',function(ev){if(!dragId)return;ev.preventDefault();var el=findBlock(ev.target);if(el&&el.dataset.sspElId!==dragId){var r=el.getBoundingClientRect();parent.postMessage({type:'REPORT_DESIGNER_MOVE',elementId:dragId,targetId:el.dataset.sspElId,position:ev.clientY<r.top+r.height/2?'before':'after'},'*');}clearDrop();});
    document.addEventListener('dragend',function(){var d=document.querySelector('.ez-dragging');if(d)d.classList.remove('ez-dragging');clearDrop();dragId=null;});
    document.addEventListener('dblclick',function(ev){var ed=ev.target;while(ed&&ed!==document.body){if(ed.dataset&&ed.dataset.edit)break;ed=ed.parentElement;}if(!ed||ed===document.body)return;var host=ed;while(host&&host!==document.body&&!(host.dataset&&host.dataset.sspElId))host=host.parentElement;var id=host&&host.dataset?host.dataset.sspElId:null;if(!id)return;ev.preventDefault();host.setAttribute('draggable','false');ed.setAttribute('contenteditable','true');ed.style.outline='2px solid #f3a40a';ed.style.background='rgba(243,164,10,0.10)';ed.focus();try{var rg=document.createRange();rg.selectNodeContents(ed);var sl=window.getSelection();sl.removeAllRanges();sl.addRange(rg);}catch(e){}var done=false;var commit=function(){if(done)return;done=true;host.setAttribute('draggable','true');ed.removeAttribute('contenteditable');ed.style.outline='';ed.style.background='';ed.removeEventListener('blur',commit);ed.removeEventListener('keydown',onKey);parent.postMessage({type:'REPORT_DESIGNER_EDIT',elementId:id,edit:ed.dataset.edit,r:ed.dataset.r,c:ed.dataset.c,value:ed.innerText},'*');};var onKey=function(e){if(e.key==='Enter'&&ed.dataset.edit!=='text'){e.preventDefault();ed.blur();}else if(e.key==='Escape'){e.preventDefault();ed.blur();}};ed.addEventListener('blur',commit);ed.addEventListener('keydown',onKey);},true);
  }catch(e){}})();</script>`
  const body = `<div class="workspace">${header}${els.join("")}${signature}${footer}</div><div class="ez-pagefoot"></div>${script}`
  const meta = s.pdfA ? `<meta name="pdfa" content="true">` : ""
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${s.coverTitle || "Documento"}</title>${meta}${styles}</head><body>${body}</body></html>`
  return html
}
