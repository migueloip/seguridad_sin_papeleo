/**
 * Mapeo ruta → metadatos de sección Easysecure (título mostrado en el header
 * y clave de navegación activa en el sidebar). Se deriva del pathname para no
 * tener que pasar el título por props en cada página.
 */
export type SectionKey =
  | "dashboard"
  | "hallazgos"
  | "ia"
  | "documentos"
  | "informes"
  | "personal"
  | "planos"
  | "checklists"
  | "config"
  | "proyectos"
  | "obra"
  | "subir"
  | "admin"

export function projectBase(pathname: string): string {
  const m = pathname.match(/^\/proyectos\/(\d+)/)
  return m ? `/proyectos/${m[1]}` : ""
}

/**
 * Enlace a "Obra integral": si la ruta actual ya pertenece a un proyecto
 * (/proyectos/<id>/* u /obra/<id>/*) lleva directo a esa obra; si no, al
 * listado /obra.
 */
export function obraHref(pathname: string): string {
  const m = pathname.match(/^\/(?:proyectos|obra)\/(\d+)(?:\/|$)/)
  return m ? `/obra/${m[1]}` : "/obra"
}

/** Código de obra mostrado en sidebar/header, derivado del id + año de inicio. */
export function projectCode(p: { id: number; start_date?: string | null }): string {
  const year = p.start_date ? new Date(p.start_date).getFullYear() : new Date().getFullYear()
  return `OBRA-${year}-${String(p.id).padStart(3, "0")}`
}

export function sectionFromPath(pathname: string): SectionKey {
  const p = pathname.replace(/\/proyectos\/\d+/, "") || "/"
  if (p === "/" || p === "") return "dashboard"
  if (p === "/obra" || p.startsWith("/obra/")) return "obra"
  if (p.startsWith("/hallazgos")) return "hallazgos"
  if (p.startsWith("/ia")) return "ia"
  if (p.startsWith("/documentos")) return "documentos"
  if (p.startsWith("/informes")) return "informes"
  if (p.startsWith("/personal")) return "personal"
  if (p.startsWith("/planos") || p.startsWith("/mapa-riesgos")) return "planos"
  if (p.startsWith("/checklists")) return "checklists"
  if (p.startsWith("/configuracion")) return "config"
  if (p.startsWith("/proyectos")) return "proyectos"
  if (p.startsWith("/subir")) return "subir"
  if (p.startsWith("/admin")) return "admin"
  return "dashboard"
}

export const SECTION_TITLES: Record<SectionKey, string> = {
  dashboard: "Principal",
  hallazgos: "Hallazgos",
  ia: "Asistente IA",
  documentos: "Documentos",
  informes: "Informes",
  personal: "Personal",
  planos: "Planos y mapa de riesgos",
  checklists: "Checklists",
  config: "Configuración",
  proyectos: "Tus obras",
  obra: "Obra integral",
  subir: "Subir documentos",
  admin: "Administración",
}

export function sectionTitleFromPath(pathname: string): string {
  return SECTION_TITLES[sectionFromPath(pathname)]
}
