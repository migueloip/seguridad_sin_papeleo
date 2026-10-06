/**
 * Clasificador de hallazgos por palabras clave: texto libre → categoría.
 * Puro (sin BD ni servidor; usable en cliente). Insensible a tildes y
 * mayúsculas. Gana la coincidencia más específica (mayor peso: "olor a gas"
 * antes que "gas"); a igual peso, la que aparece primero en el texto.
 */
import type { FindingCategory } from "./types"

type Keyword = { re: RegExp; category: FindingCategory; weight: number }

/** Minúsculas, sin tildes ni signos: "¡Olor a GAS!" → "olor a gas". */
export function normalizeFindingText(text: string): string {
  if (typeof text !== "string") return ""
  return text
    .slice(0, 10_000)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Patrones sobre texto normalizado (sin tildes, minúsculas, palabras separadas por un espacio). */
const k = (pattern: string, category: FindingCategory, weight: number): Keyword => ({
  re: new RegExp(`\\b(?:${pattern})`),
  category,
  weight,
})

const KEYWORDS: Keyword[] = [
  // Olor a gas o alcantarilla (lo más específico primero). "Gas" o "alcantarillado" sueltos no
  // bastan: "cilindro de gas sin cadena" o "tapa de cámara de alcantarillado rota" no son un olor
  // ni una fuga, y clasificarlos así dispararía "evacuar el sector" junto a la red de gas.
  k("olor(?:es)? a gas\\b", "olor_gas", 10),
  k("(?:fugas?|escapes?) de gas\\b", "olor_gas", 10),
  k("huele a (?:gas|alcantarill\\w*|desague\\w*|huevo podrido|azufre)", "olor_gas", 10),
  k("olor(?:es)? a (?:alcantarill\\w*|desague\\w*|huevo podrido|azufre)", "olor_gas", 10),
  k("gas(?:es)?\\b.{0,40}\\b(?:fugas?|escapes?|olor\\w*|huele|hedor)", "olor_gas", 8),
  k("(?:fugas?|escapes?|olor\\w*|huele|hedor)\\b.{0,40}\\bgas(?:es)?\\b", "olor_gas", 8),
  k("(?:metano|acido sulfhidrico|h2s)\\b", "olor_gas", 6),
  k("(?:mal )?olor(?:es)?\\b|hedor\\w*|pestilencia", "olor_gas", 3),

  // Falla eléctrica
  k("olor(?:es)? a quemado", "falla_electrica", 10),
  k("cables? pelad[oa]s?\\b", "falla_electrica", 9),
  k("descargas? electric\\w*|electrocu\\w*", "falla_electrica", 9),
  k("cables? (?:expuest|cortad|danad|suelt)[oa]s?\\b", "falla_electrica", 8),
  k("corto ?circuito\\w*", "falla_electrica", 8),
  k("chisp\\w*", "falla_electrica", 7),
  k("(?:salta|saltan|se cae|se corta) (?:el )?(?:automatico|diferencial)\\b", "falla_electrica", 7),
  k("enchuf\\w*", "falla_electrica", 5),
  k("tableros?\\b", "falla_electrica", 5),
  k("(?:sin luz|apagon\\w*)", "falla_electrica", 4),
  k("electric\\w*", "falla_electrica", 4),

  // Humedad / filtración
  k("manchas? de (?:agua|humedad)\\b", "humedad_filtracion", 9),
  k("fugas? de agua\\b", "humedad_filtracion", 9),
  k("filtraci\\w*", "humedad_filtracion", 7),
  k("goter\\w*", "humedad_filtracion", 7),
  k("filtra(?:n|ndo)?\\b", "humedad_filtracion", 6),
  k("gote(?:a|an|ando|o)\\b", "humedad_filtracion", 6),
  k("humed\\w*", "humedad_filtracion", 6),
  k("(?:eflorescencia\\w*|salitre\\w*|condensaci\\w*|inund\\w*)", "humedad_filtracion", 5),
  k("mojad[oa]s?\\b", "humedad_filtracion", 4),

  // Grietas
  k("griet\\w*|agriet\\w*", "grieta", 6),
  k("fisur\\w*", "grieta", 6),
  k("triza\\w*", "grieta", 6),
  k("rajadura\\w*", "grieta", 5),

  // Hundimiento / asentamiento
  k("socav\\w*", "hundimiento", 8),
  k("hundimient\\w*", "hundimiento", 7),
  k("asentamient\\w*", "hundimiento", 7),
  k("hundid[oa]s?\\b|se hunde\\w*", "hundimiento", 6),

  // Corrosión
  k("corrosi\\w*|corroid[oa]s?\\b", "corrosion", 7),
  k("oxid\\w*|herrumbre", "corrosion", 6),

  // Desprendimiento
  k(
    "caidas? de (?:material\\w*|escombros?|estuco|hormigon|ladrillos?|revestimiento\\w*|ceramic\\w*|cielo\\w*)",
    "desprendimiento",
    9,
  ),
  k("(?:estuco|revestimiento|ceramica|cielo falso|palmeta|enchape)s? suelt[oa]s?\\b", "desprendimiento", 9),
  k("desprend\\w*", "desprendimiento", 8),
  k("descascar\\w*|material suelto", "desprendimiento", 6),

  // Obstrucción / rebalse
  k("rebals\\w*", "obstruccion", 8),
  k("obstru\\w*", "obstruccion", 7),
  k("tapad[oa]s?\\b", "obstruccion", 6),
  k("(?:atascad|atochad)[oa]s?\\b|no (?:escurre|drena)\\b", "obstruccion", 6),

  // Excavación (pesa menos que el daño observado: "grieta junto a la excavación" es una grieta,
  // y la excavación cercana la aporta el plano)
  k("excava\\w*", "excavacion", 5),
  k("zanjas?\\b", "excavacion", 5),
  k("calicatas?\\b", "excavacion", 5),
  k("talud\\w*", "excavacion", 4),
]

/**
 * Categoría del hallazgo según su texto (título + descripción). Devuelve
 * "otro" si no reconoce ninguna palabra clave.
 */
export function classifyFindingText(text: string): FindingCategory {
  const t = normalizeFindingText(text)
  if (!t) return "otro"
  let best: { category: FindingCategory; weight: number; index: number } | null = null
  for (const kw of KEYWORDS) {
    const m = kw.re.exec(t)
    if (!m) continue
    if (!best || kw.weight > best.weight || (kw.weight === best.weight && m.index < best.index)) {
      best = { category: kw.category, weight: kw.weight, index: m.index }
    }
  }
  return best?.category ?? "otro"
}
