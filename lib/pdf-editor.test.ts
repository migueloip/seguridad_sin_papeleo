import { describe, it, expect } from "vitest"
import { validateEditorState, buildEditorHtmlFromState, buildDesignerHtmlFromState, type EditorState } from "./pdf-editor"

describe("validateEditorState", () => {
  it("valida campos obligatorios y secciones vacías", () => {
    const s: EditorState = {
      pdfFont: "sans-serif",
      pdfFontSize: 14,
      pdfColor: "#111827",
      editorSections: ["cover", "summary", "matrix", "docs", "quotes", "recs"],
      coverTitle: "",
      coverSubtitle: "",
      summaryText: "",
      matrixRows: [],
      recs: [],
      brandLogo: null,
      responsibleName: "",
      pdfA: false,
      docs: [],
      quotes: [],
    }
    const alerts = validateEditorState(s)
    expect(alerts).toContain("La portada requiere un título")
    expect(alerts).toContain("El resumen ejecutivo está vacío")
    expect(alerts).toContain("La matriz de hallazgos no tiene filas")
    expect(alerts).toContain("La sección de recomendaciones está vacía")
    expect(alerts).toContain("La sección de documentos está vacía")
    expect(alerts).toContain("La sección de citas está vacía")
    expect(alerts).toContain("Falta el nombre del responsable en el pie de página")
  })
})

describe("buildEditorHtmlFromState", () => {
  it("incluye citas y pie de página", () => {
    const s: EditorState = {
      pdfFont: "sans-serif",
      pdfFontSize: 14,
      pdfColor: "#111827",
      editorSections: ["cover", "summary", "matrix", "quotes", "recs"],
      coverTitle: "Informe",
      coverSubtitle: "Subtítulo",
      summaryText: "Texto",
      matrixRows: [{ description: "Desc", severity: "medio", status: "pendiente", date: "2024-01-01" }],
      recs: ["Acción 1"],
      brandLogo: null,
      responsibleName: "Responsable",
      responsibleSignatureDataUrl: "data:image/png;base64,AAAA",
      pdfA: false,
      quotes: [{ name: "Persona", role: "Cargo", date: "2024-01-02", content: "Contenido", signatureDataUrl: null }],
    }
    const html = buildEditorHtmlFromState(s)
    expect(html).toMatch(/Citas de Personal/)
    expect(html).toMatch(/Firma del Prevencionista de Riesgo/)
    expect(html).toMatch(/page-number/)
    expect(html).toMatch(/Responsable: Responsable/)
  })
})

describe("buildDesignerHtmlFromState", () => {
  it("renderiza simple_section", () => {
    const s: EditorState = {
      pdfFont: "sans-serif",
      pdfFontSize: 14,
      pdfColor: "#111827",
      editorSections: ["cover", "summary", "matrix", "quotes", "recs"],
      coverTitle: "Informe",
      coverSubtitle: "Subtítulo",
      summaryText: "Texto",
      matrixRows: [{ description: "Desc", severity: "medio", status: "pendiente", date: "2024-01-01" }],
      recs: ["Acción 1"],
      brandLogo: null,
      responsibleName: "Responsable",
      pdfA: false,
      designerEnabled: true,
      elements: [
        { id: "sec-1", type: "simple_section", title: "Resumen", subtitle: "KPIs", body: "Línea 1", bullets: ["Uno"], chips: ["A"], align: "left" },
      ],
    }
    const html = buildDesignerHtmlFromState(s)
    expect(html).toMatch(/Resumen/)
    expect(html).toMatch(/KPIs/)
    expect(html).toMatch(/Línea 1/)
  })

  it("renderiza tabla y matriz con cabeceras", () => {
    const s: EditorState = {
      pdfFont: "sans-serif",
      pdfFontSize: 14,
      pdfColor: "#111827",
      editorSections: ["cover", "summary", "matrix", "quotes", "recs"],
      coverTitle: "Informe",
      coverSubtitle: "Subtítulo",
      summaryText: "Texto",
      matrixRows: [{ description: "Desc", severity: "medio", status: "pendiente", date: "2024-01-01" }],
      recs: [],
      brandLogo: null,
      responsibleName: "Responsable",
      pdfA: false,
      designerEnabled: true,
      elements: [
        {
          id: "tbl-1",
          type: "table",
          rows: [
            ["Actividad / tarea", "Peligro", "Riesgo"],
            ["Corte", "Elemento cortante", "Lesión en mano"],
          ],
        },
        {
          id: "mx-1",
          type: "matrix",
          rows: [{ description: "Desc", severity: "medio", status: "pendiente", date: "2024-01-01" }],
        },
      ],
    }
    const html = buildDesignerHtmlFromState(s)
    expect(html).toMatch(/Actividad \/ tarea/)
    expect(html).toMatch(/Matriz de Hallazgos/)
  })
})
