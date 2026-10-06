/**
 * Reglas de correlación espacial hallazgo × elemento del plano.
 *
 * Cada regla dice: "si un hallazgo de categoría C está a menos de D metros (en
 * planta) de un elemento de tipo T, en el mismo nivel o en uno adyacente,
 * entonces la hipótesis H es plausible y conviene ejecutar las acciones A".
 * Las aplica el motor determinista de lib/obra/correlation.ts; la IA solo
 * redacta y prioriza sobre estas correlaciones verificables.
 *
 * Placeholders de `hypothesis` (los rellena correlation.ts):
 *   {elemento}  descripción del elemento con artículo, p.ej. "el colector de alcantarillado «C-3» Ø160"
 *   {distancia} distancia en planta con coma decimal, p.ej. "1,2 m"
 *   {capa}      nombre de la capa, p.ej. "Alcantarillado N1"
 *   {relacion}  "en el mismo nivel", "en el nivel inferior (bajo el hallazgo)" o
 *               "en el nivel superior (sobre el hallazgo)"
 *   {verbo}     "pasa" para elementos lineales (tuberías, ductos, redes) o
 *               "se ubica" para el resto (cámaras, tableros, columnas...)
 *
 * Criterio de plazos (due_in_days): crítica 0–1 días, alta ≤ 3, media ≤ 7, baja ≤ 14.
 * Referencias normativas citadas: DS 594 (condiciones sanitarias y ambientales
 * básicas en los lugares de trabajo), NCh 349 (seguridad en excavaciones) e
 * instaladores autorizados por la SEC.
 */
import type { CorrelationRule, ElementType, LevelRelation } from "./types"

/** Radio máximo de búsqueda alrededor del hallazgo, en metros (en planta). */
export const DEFAULT_SEARCH_RADIUS_M = 6

const MISMO_NIVEL: LevelRelation[] = ["mismo_nivel"]
const MISMO_E_INFERIOR: LevelRelation[] = ["mismo_nivel", "nivel_inferior"]
const MISMO_Y_SUPERIOR: LevelRelation[] = ["mismo_nivel", "nivel_superior"]
const TODOS_LOS_NIVELES: LevelRelation[] = ["mismo_nivel", "nivel_inferior", "nivel_superior"]

/** Redes e instalaciones (todo lo que no es estructura ni arquitectura). */
const REDES: ElementType[] = [
  "tuberia_alcantarillado",
  "camara_inspeccion",
  "tuberia_agua",
  "tuberia_aguas_lluvia",
  "ducto_electrico",
  "tablero_electrico",
  "linea_gas",
  "medidor_gas",
  "ducto_clima",
  "red_incendio",
]

export const CORRELATION_RULES: CorrelationRule[] = [
  // -------------------------------------------------------------------------
  // Grietas
  // -------------------------------------------------------------------------
  {
    id: "grieta_alcantarillado",
    categories: ["grieta"],
    element_types: ["tuberia_alcantarillado", "camara_inspeccion"],
    max_distance_m: 3,
    relations: MISMO_E_INFERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Una filtración del colector o de sus uniones puede saturar y socavar el suelo de fundación y provocar un asentamiento diferencial, lo que explicaría la grieta.",
    recommended_actions: [
      "Inspeccionar el tramo del colector con cámara CCTV y registrar uniones abiertas, roturas o desplazamientos.",
      "Hacer prueba de estanqueidad del tramo entre las cámaras más cercanas.",
      "Instalar testigos de yeso o fisurómetro en la grieta y registrar ancho (mm) y fecha en cada visita.",
      "Revisar la cámara de inspección más cercana: nivel de agua, rebalses, filtraciones y estado de la banqueta.",
      "Si la grieta progresa, restringir el acceso al sector e informar al ingeniero calculista.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 3,
  },
  {
    id: "grieta_estructural",
    categories: ["grieta"],
    element_types: ["muro_carga", "columna", "viga", "losa", "fundacion"],
    max_distance_m: 1,
    relations: MISMO_NIVEL,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Una grieta en o junto a un elemento estructural puede indicar daño estructural (sobrecarga, asentamiento o corrosión de armaduras) y debe evaluarla un ingeniero calculista.",
    recommended_actions: [
      "Solicitar evaluación del ingeniero calculista: tipo de grieta, ancho, patrón y causa probable.",
      "Medir y fotografiar la grieta con escala; instalar fisurómetro o testigos para seguir su evolución.",
      "Si la grieta progresa o hay deformaciones visibles, restringir el acceso al sector y apuntalar según indique el calculista.",
      "Registrar el hallazgo en el libro de obra e informar a la ITO.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 2,
  },
  {
    id: "grieta_tabique",
    categories: ["grieta"],
    element_types: ["muro"],
    max_distance_m: 1,
    relations: MISMO_NIVEL,
    base_priority: "media",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La capa no indica si el muro es estructural: si es un tabique, la fisura suele deberse a retracción, dilatación o falta de junta; si es un muro de hormigón armado o de albañilería estructural, puede indicar un daño que debe evaluar el ingeniero calculista.",
    recommended_actions: [
      "Confirmar en los planos de estructura si el muro es estructural (hormigón armado o albañilería); si lo es, pedir la evaluación del ingeniero calculista.",
      "Verificar si la fisura es solo de terminación (estuco, pintura) o atraviesa el muro.",
      "Revisar si hay grietas similares en losas, vigas o muros de carga cercanos.",
      "Marcar la fisura con fecha y revisarla en la próxima visita antes de reparar.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 5,
  },
  {
    id: "grieta_agua",
    categories: ["grieta"],
    element_types: ["tuberia_agua", "tuberia_aguas_lluvia"],
    max_distance_m: 2,
    relations: MISMO_E_INFERIOR,
    base_priority: "media",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Una filtración de la tubería o de sus uniones puede humedecer el muro o el suelo de apoyo y abrir o agrandar la grieta.",
    recommended_actions: [
      "Verificar fugas: prueba de presión del tramo de agua potable o prueba de escurrimiento en aguas lluvia.",
      "Buscar manchas de humedad, eflorescencias o suelo saturado junto a la grieta.",
      "Instalar testigo o fisurómetro en la grieta y registrar su evolución.",
      "Reparar uniones o tramos dañados con instalador autorizado antes de reparar la grieta.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 5,
  },

  // -------------------------------------------------------------------------
  // Humedad / filtración
  // -------------------------------------------------------------------------
  {
    id: "humedad_agua_potable",
    categories: ["humedad_filtracion"],
    element_types: ["tuberia_agua"],
    max_distance_m: 3,
    relations: MISMO_Y_SUPERIOR,
    base_priority: "media",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La humedad podría deberse a una fuga en la tubería de agua potable o en sus uniones.",
    recommended_actions: [
      "Cerrar todas las llaves del sector y observar el medidor: si avanza, hay fuga.",
      "Hacer prueba de presión hidrostática del tramo afectado.",
      "Abrir un registro o sondaje acotado en el punto de humedad antes de demoler más.",
      "Verificar que no haya circuitos eléctricos mojados en el sector.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 3,
  },
  {
    id: "humedad_alcantarillado",
    categories: ["humedad_filtracion"],
    element_types: ["tuberia_alcantarillado", "camara_inspeccion"],
    max_distance_m: 3,
    relations: MISMO_Y_SUPERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La humedad podría ser una filtración de aguas servidas, con riesgo sanitario para los trabajadores y de daño al suelo de fundación.",
    recommended_actions: [
      "Verificar olor y aspecto del agua; si son aguas servidas, trabajar con guantes, mascarilla y lavado de manos.",
      "Inspeccionar el tramo con cámara CCTV y revisar uniones y cámaras.",
      "Hacer prueba de estanqueidad del tramo.",
      "Aislar el sector afectado y limpiar y desinfectar una vez reparado (DS 594).",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 2,
  },
  {
    id: "humedad_aguas_lluvia",
    categories: ["humedad_filtracion"],
    element_types: ["tuberia_aguas_lluvia"],
    max_distance_m: 3,
    relations: MISMO_Y_SUPERIOR,
    base_priority: "media",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La humedad podría venir de una bajada o canaleta de aguas lluvia obstruida, rota o mal sellada, sobre todo si aparece después de lluvias.",
    recommended_actions: [
      "Revisar bajadas, canaletas y sumideros: obstrucciones, uniones sueltas o roturas.",
      "Hacer prueba de escurrimiento con agua y observar el punto de humedad.",
      "Verificar la impermeabilización de la cubierta o losa sobre el sector.",
      "Programar la reparación antes de la próxima lluvia.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 5,
  },
  {
    id: "humedad_red_incendio",
    categories: ["humedad_filtracion"],
    element_types: ["red_incendio"],
    max_distance_m: 3,
    relations: MISMO_Y_SUPERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Una fuga en la red contra incendio, además de la humedad, puede dejarla sin presión cuando se necesite.",
    recommended_actions: [
      "Revisar la presión de la red y buscar goteos en uniones, válvulas y gabinetes.",
      "Coordinar la reparación con el instalador de la red sin dejar el sector sin protección.",
      "Si hay que despresurizar, avisar al prevencionista y reforzar extintores mientras dure el trabajo.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 3,
  },
  {
    id: "humedad_electrico",
    categories: ["humedad_filtracion"],
    element_types: ["ducto_electrico", "tablero_electrico"],
    max_distance_m: 2,
    relations: MISMO_E_INFERIOR,
    base_priority: "critica",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). El agua cerca de circuitos energizados genera riesgo de electrocución, cortocircuito e incendio.",
    recommended_actions: [
      "Cortar la energía del circuito afectado desde el tablero y aplicar bloqueo y etiquetado (LOTO).",
      "Señalizar y restringir el acceso al sector mojado.",
      "Solicitar inspección de un electricista autorizado SEC antes de reenergizar.",
      "Verificar el funcionamiento del protector diferencial del circuito.",
      "Eliminar la fuente de agua antes de restablecer el servicio.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 0,
  },
  {
    id: "humedad_climatizacion",
    categories: ["humedad_filtracion"],
    element_types: ["ducto_clima"],
    max_distance_m: 2,
    relations: MISMO_Y_SUPERIOR,
    base_priority: "baja",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La humedad podría ser condensación del ducto (aislación dañada) o una falla en el drenaje de condensado del equipo.",
    recommended_actions: [
      "Revisar la aislación térmica del ducto y su barrera de vapor.",
      "Verificar que el drenaje de condensado del equipo descargue bien y no esté obstruido.",
      "Coordinar la reparación con el instalador de climatización.",
    ],
    suggested_role: "supervisor",
    due_in_days: 7,
  },

  // -------------------------------------------------------------------------
  // Olor a gas o alcantarilla
  // -------------------------------------------------------------------------
  {
    id: "olor_gas_red_gas",
    categories: ["olor_gas"],
    element_types: ["linea_gas", "medidor_gas"],
    max_distance_m: 5,
    relations: TODOS_LOS_NIVELES,
    base_priority: "critica",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). El olor indica una posible fuga de gas en la red o en el medidor, con riesgo de incendio, explosión o intoxicación.",
    recommended_actions: [
      "Evacuar el sector y ventilar abriendo puertas y ventanas, sin accionar interruptores.",
      "Eliminar toda fuente de ignición: no fumar ni usar herramientas eléctricas, esmeriles o celulares en la zona.",
      "Cortar el suministro en la llave de paso o en el medidor.",
      "Avisar a la empresa distribuidora y a un instalador de gas autorizado SEC para ubicar y reparar la fuga.",
      "No reingresar hasta medir ausencia de gas con un detector (explosímetro).",
    ],
    suggested_role: "prevencionista",
    due_in_days: 0,
  },
  {
    id: "olor_alcantarillado",
    categories: ["olor_gas"],
    element_types: ["tuberia_alcantarillado", "camara_inspeccion"],
    max_distance_m: 4,
    relations: MISMO_E_INFERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). El olor podría corresponder a gases de alcantarillado (ácido sulfhídrico H2S, metano) por un sello hidráulico seco, un sifón defectuoso o ventilación insuficiente.",
    recommended_actions: [
      "Medir gases (O2, H2S, CO y explosividad) con detector multigás antes de ingresar a cámaras o zanjas.",
      "Tratar las cámaras como espacio confinado: permiso de trabajo, vigía, ventilación forzada y equipo de rescate.",
      "Revisar sellos hidráulicos y sifones de artefactos y piletas; rellenar los que estén secos.",
      "Verificar que la ventilación del alcantarillado esté conectada y despejada.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 1,
  },

  // -------------------------------------------------------------------------
  // Fallas eléctricas
  // -------------------------------------------------------------------------
  {
    id: "falla_electrica_circuito",
    categories: ["falla_electrica"],
    element_types: ["ducto_electrico", "tablero_electrico"],
    max_distance_m: 2,
    relations: MISMO_NIVEL,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La falla podría originarse en ese circuito: conductor dañado, conexión suelta o protección mal dimensionada.",
    recommended_actions: [
      "Desenergizar el circuito y aplicar bloqueo y etiquetado (LOTO) antes de intervenir.",
      "Solicitar revisión de un electricista autorizado SEC: aislación, conexiones y protecciones.",
      "Probar el protector diferencial y los automáticos del tablero.",
      "Señalizar el sector y retirar extensiones o enchufes dañados.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 1,
  },
  {
    id: "falla_electrica_agua",
    categories: ["falla_electrica"],
    element_types: ["tuberia_agua", "tuberia_aguas_lluvia", "tuberia_alcantarillado", "red_incendio"],
    max_distance_m: 1.5,
    relations: MISMO_Y_SUPERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La cercanía entre agua y electricidad sugiere que una filtración podría estar causando la falla (agua en cajas de derivación o canalizaciones).",
    recommended_actions: [
      "Desenergizar el circuito y revisar cajas de derivación y canalizaciones por presencia de agua.",
      "Buscar fugas en la tubería cercana (inspección visual o prueba de presión).",
      "Verificar la separación y los sellos entre canalizaciones eléctricas y sanitarias.",
      "Reenergizar solo con el visto bueno de un electricista autorizado SEC.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 1,
  },
  {
    id: "falla_electrica_gas",
    categories: ["falla_electrica"],
    element_types: ["linea_gas", "medidor_gas"],
    max_distance_m: 2,
    relations: MISMO_NIVEL,
    base_priority: "critica",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Una chispa o arco eléctrico junto a la red de gas es una fuente de ignición ante cualquier fuga.",
    recommended_actions: [
      "Desenergizar de inmediato el circuito con falla y aplicar bloqueo y etiquetado (LOTO).",
      "Verificar ausencia de fuga con detector de gas (nunca con llama).",
      "Solicitar revisión conjunta de electricista e instalador de gas autorizados SEC.",
      "Mantener un extintor PQS disponible en el sector hasta terminar la reparación.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 0,
  },

  // -------------------------------------------------------------------------
  // Hundimientos / asentamientos
  // -------------------------------------------------------------------------
  {
    id: "hundimiento_red",
    categories: ["hundimiento"],
    element_types: ["tuberia_alcantarillado", "camara_inspeccion", "tuberia_agua", "tuberia_aguas_lluvia"],
    max_distance_m: 3,
    relations: MISMO_E_INFERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Una fuga de la tubería puede arrastrar los finos del suelo (socavación) y formar el hundimiento o un socavón.",
    recommended_actions: [
      "Delimitar y señalizar la zona hundida; prohibir el tránsito de vehículos y maquinaria.",
      "Inspeccionar la tubería con cámara CCTV o con prueba de estanqueidad o de presión.",
      "Hacer sondaje o calicata manual para detectar cavidades bajo el radier o pavimento.",
      "Reparar la tubería y rellenar con material compactado por capas antes de reponer el pavimento.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 2,
  },
  {
    id: "hundimiento_estructura",
    categories: ["hundimiento"],
    element_types: ["fundacion", "columna", "muro_carga"],
    max_distance_m: 2,
    relations: MISMO_E_INFERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). El hundimiento junto a un elemento estructural puede indicar asentamiento de la fundación o pérdida de soporte del suelo.",
    recommended_actions: [
      "Solicitar evaluación urgente del ingeniero calculista y, si corresponde, del mecánico de suelos.",
      "Instalar puntos de control topográfico y medir asentamientos en cada visita.",
      "Restringir cargas y acopios en el sector; apuntalar si hay deformaciones visibles.",
      "Revisar si hay fugas de agua o excavaciones cercanas que expliquen la pérdida de soporte.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 1,
  },

  // -------------------------------------------------------------------------
  // Excavaciones con interferencias
  // -------------------------------------------------------------------------
  {
    id: "excavacion_red_sanitaria",
    categories: ["excavacion"],
    element_types: [
      "tuberia_alcantarillado",
      "camara_inspeccion",
      "tuberia_agua",
      "tuberia_aguas_lluvia",
      "red_incendio",
    ],
    max_distance_m: 2,
    relations: MISMO_E_INFERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La excavación puede interferir con esa red enterrada: riesgo de rotura, inundación de la zanja o desestabilización de sus paredes.",
    recommended_actions: [
      "Ubicar y marcar en terreno el trazado de la red (planos, detector de servicios o georradar) antes de seguir excavando.",
      "Excavar a mano en una franja de 1 m a cada lado de la red.",
      "Emitir permiso de trabajo de excavación con entibación o talud estable según NCh 349.",
      "Coordinar con la empresa sanitaria o el instalador si hay que intervenir o proteger la red.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 1,
  },
  {
    id: "excavacion_gas",
    categories: ["excavacion"],
    element_types: ["linea_gas", "medidor_gas"],
    max_distance_m: 2,
    relations: MISMO_E_INFERIOR,
    base_priority: "critica",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Excavar junto a una red de gas puede romperla y provocar una fuga con riesgo de incendio o explosión.",
    recommended_actions: [
      "Detener la excavación mecánica en el sector hasta ubicar la red con exactitud.",
      "Pedir a la distribuidora de gas el trazado y la profundidad de la red y marcarlos en terreno.",
      "Excavar solo a mano en la franja de seguridad, con permiso de trabajo y supervisión directa.",
      "Mantener extintor PQS y detector de gas en el frente de trabajo; prohibir fuentes de ignición.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 0,
  },
  {
    id: "excavacion_electrico",
    categories: ["excavacion"],
    element_types: ["ducto_electrico", "tablero_electrico"],
    max_distance_m: 2,
    relations: MISMO_E_INFERIOR,
    base_priority: "critica",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Excavar junto a una canalización eléctrica enterrada expone a contacto eléctrico y a cortar circuitos energizados.",
    recommended_actions: [
      "Detener la excavación mecánica hasta ubicar la canalización con un detector de cables.",
      "Confirmar que el circuito esté desenergizado, con bloqueo y etiquetado (LOTO), antes de excavar cerca.",
      "Excavar a mano con herramientas aisladas en la franja de seguridad.",
      "Emitir permiso de trabajo y mantener supervisión directa durante toda la faena.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 0,
  },
  {
    id: "excavacion_fundacion",
    categories: ["excavacion"],
    element_types: ["fundacion", "columna", "muro_carga"],
    max_distance_m: 2,
    relations: MISMO_E_INFERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Excavar junto a una fundación puede descalzarla o quitarle confinamiento lateral y provocar asentamientos o grietas en la estructura.",
    recommended_actions: [
      "Verificar con el ingeniero calculista la cota de sello de fundación y la profundidad máxima permitida.",
      "No excavar bajo la cota de fundación sin un procedimiento de recalce aprobado.",
      "Entibar o dejar talud estable según NCh 349 y vigilar grietas en la estructura vecina.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 1,
  },

  {
    id: "excavacion_inestabilidad",
    categories: ["hundimiento", "grieta", "desprendimiento"],
    element_types: ["excavacion"],
    max_distance_m: 3,
    relations: MISMO_E_INFERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Una excavación sin entibación suficiente, con talud inestable o con sobrecarga en su borde puede provocar el derrumbe de sus paredes o descalzar el terreno y las fundaciones vecinas, lo que explicaría el hallazgo.",
    recommended_actions: [
      "Alejar a las personas del borde de la excavación y prohibir el ingreso a la zanja hasta evaluarla.",
      "Retirar acopios, escombros, maquinaria y vehículos del borde (franja mínima según NCh 349).",
      "Verificar la entibación o el talud según NCh 349 y reforzarlos si hay grietas, desprendimientos o filtraciones en las paredes.",
      "Revisar grietas o asentamientos en estructuras, pavimentos y redes vecinas e instalar testigos para seguir su evolución.",
      "Informar al ingeniero calculista o al mecánico de suelos si el hundimiento o las grietas progresan.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 1,
  },
  {
    id: "excavacion_condicion",
    categories: ["excavacion"],
    element_types: ["excavacion"],
    max_distance_m: 2,
    relations: MISMO_NIVEL,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). El hallazgo corresponde a esa excavación: conviene verificar que cumpla las condiciones de seguridad de NCh 349 (entibación o talud, bordes y accesos).",
    recommended_actions: [
      "Verificar la entibación o el talud estable según el tipo de suelo y la profundidad (NCh 349).",
      "Instalar barandas y señalización en todo el borde y mantener despejada una franja sin acopios ni maquinaria.",
      "Habilitar escaleras de acceso y salida a distancias adecuadas dentro de la excavación.",
      "Revisar el permiso de trabajo de excavación y que la supervisión esté presente durante la faena.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 1,
  },

  // -------------------------------------------------------------------------
  // Desprendimientos
  // -------------------------------------------------------------------------
  {
    id: "desprendimiento_electrico",
    categories: ["desprendimiento"],
    element_types: ["ducto_electrico", "tablero_electrico"],
    max_distance_m: 2,
    relations: MISMO_NIVEL,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). El material desprendido puede haber dañado la canalización o dejado conductores expuestos.",
    recommended_actions: [
      "Aislar el área y retirar el material suelto con casco, lentes y guantes.",
      "Revisar la canalización: tubos rotos, cajas abiertas o conductores expuestos; desenergizar si hay daño.",
      "Reparar con electricista autorizado SEC antes de reabrir el sector.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 1,
  },
  {
    id: "desprendimiento_red_incendio",
    categories: ["desprendimiento"],
    element_types: ["red_incendio"],
    max_distance_m: 2,
    relations: MISMO_NIVEL,
    base_priority: "media",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). El desprendimiento puede haber dañado soportes, rociadores o gabinetes de la red contra incendio.",
    recommended_actions: [
      "Revisar soportes, uniones, rociadores y gabinetes de la red en el sector.",
      "Verificar presión y operación de la red después de retirar el material.",
      "Reparar los daños con el instalador de la red y dejar registro.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 2,
  },
  {
    id: "desprendimiento_losa",
    categories: ["desprendimiento"],
    element_types: ["losa", "viga"],
    max_distance_m: 1.5,
    relations: MISMO_Y_SUPERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). El material podría venir de la losa o la viga (estuco, recubrimiento u hormigón suelto); si hay armadura expuesta u oxidada, puede haber corrosión de la enfierradura.",
    recommended_actions: [
      "Acordonar el área bajo el elemento y prohibir el tránsito.",
      "Retirar el material suelto de forma controlada, con casco, lentes y protección contra caídas si se trabaja en altura.",
      "Revisar si hay armadura expuesta u oxidada y pedir evaluación del ingeniero calculista.",
      "Instalar malla o protección provisoria hasta la reparación.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 1,
  },

  // -------------------------------------------------------------------------
  // Corrosión
  // -------------------------------------------------------------------------
  {
    id: "corrosion_agua_potable",
    categories: ["corrosion"],
    element_types: ["tuberia_agua"],
    max_distance_m: 1.5,
    relations: MISMO_NIVEL,
    base_priority: "media",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La corrosión puede adelgazar la tubería de agua potable o sus uniones hasta producir fugas y afectar la calidad del agua.",
    recommended_actions: [
      "Revisar el estado de la tubería y sus uniones; reemplazar el tramo si hay picaduras o pérdida de espesor.",
      "Verificar si hay par galvánico (cobre en contacto con acero o fierro galvanizado) y aislarlo.",
      "Programar el reemplazo con instalador autorizado.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 7,
  },
  {
    id: "corrosion_red_incendio",
    categories: ["corrosion"],
    element_types: ["red_incendio"],
    max_distance_m: 1.5,
    relations: MISMO_NIVEL,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La corrosión puede comprometer la presión y la operación de la red contra incendio cuando se necesite.",
    recommended_actions: [
      "Inspeccionar la red, válvulas y gabinetes del sector y registrar el grado de corrosión.",
      "Hacer prueba de presión y de caudal de la red.",
      "Reemplazar tramos o accesorios dañados y reforzar la protección anticorrosiva.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 3,
  },
  {
    id: "corrosion_gas",
    categories: ["corrosion"],
    element_types: ["linea_gas", "medidor_gas"],
    max_distance_m: 1.5,
    relations: MISMO_NIVEL,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La corrosión de la red de gas puede perforarla y producir una fuga.",
    recommended_actions: [
      "Verificar ausencia de fuga con detector de gas o agua jabonosa en las uniones (nunca con llama).",
      "Solicitar inspección de un instalador de gas autorizado SEC y reemplazar los tramos corroídos.",
      "Revisar la pintura o protección anticorrosiva y los soportes de la red.",
    ],
    suggested_role: "prevencionista",
    due_in_days: 1,
  },
  {
    id: "corrosion_estructura",
    categories: ["corrosion"],
    element_types: ["viga", "columna", "losa", "muro_carga"],
    max_distance_m: 1,
    relations: MISMO_NIVEL,
    base_priority: "media",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). La corrosión en o junto a un elemento estructural puede indicar armaduras expuestas o perfiles metálicos que pierden sección.",
    recommended_actions: [
      "Revisar si hay armadura expuesta, fisuras paralelas a las barras u hormigón desprendido.",
      "Pedir evaluación del ingeniero calculista si hay pérdida de sección.",
      "Programar limpieza y pasivación de armaduras y reparación del recubrimiento.",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 5,
  },

  // -------------------------------------------------------------------------
  // Obstrucciones / rebalses
  // -------------------------------------------------------------------------
  {
    id: "obstruccion_alcantarillado",
    categories: ["obstruccion"],
    element_types: ["tuberia_alcantarillado", "camara_inspeccion"],
    max_distance_m: 4,
    relations: MISMO_E_INFERIOR,
    base_priority: "alta",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Una obstrucción en el colector o en la cámara puede provocar rebalse de aguas servidas, con riesgo sanitario y de filtración al terreno.",
    recommended_actions: [
      "Abrir la cámara más cercana, con medición de gases previa, y verificar nivel y escurrimiento.",
      "Desobstruir con hidrojet o varillas; no ingresar a la cámara sin procedimiento de espacio confinado.",
      "Inspeccionar con cámara CCTV si la obstrucción se repite (escombros, raíces, contrapendiente).",
      "Limpiar y desinfectar el área afectada por el rebalse (DS 594).",
    ],
    suggested_role: "jefe_obra",
    due_in_days: 1,
  },
  {
    id: "obstruccion_aguas_lluvia",
    categories: ["obstruccion"],
    element_types: ["tuberia_aguas_lluvia"],
    max_distance_m: 4,
    relations: MISMO_E_INFERIOR,
    base_priority: "media",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Escombros o residuos de obra en sumideros o bajadas pueden obstruir la red de aguas lluvia y provocar rebalses e inundaciones en la próxima lluvia.",
    recommended_actions: [
      "Limpiar sumideros, canaletas y bajadas; retirar escombros y residuos de obra.",
      "Hacer prueba de escurrimiento para confirmar que la red descarga bien.",
      "Proteger los sumideros con rejilla o malla mientras dure la obra.",
    ],
    suggested_role: "supervisor",
    due_in_days: 3,
  },

  // -------------------------------------------------------------------------
  // Contexto genérico (cualquier hallazgo cerca de una red)
  // -------------------------------------------------------------------------
  {
    id: "contexto_red_cercana",
    categories: ["*"],
    element_types: REDES,
    max_distance_m: DEFAULT_SEARCH_RADIUS_M,
    relations: TODOS_LOS_NIVELES,
    base_priority: "baja",
    hypothesis:
      "A {distancia}, {relacion}, {verbo} {elemento} (capa {capa}). Se informa como contexto: considerar esta red al investigar la causa del hallazgo y antes de picar, perforar o excavar en el sector.",
    recommended_actions: [
      "Verificar en terreno si el hallazgo tiene relación con la red indicada.",
      "Considerar el trazado de la red antes de picar, perforar o excavar en el sector.",
    ],
    suggested_role: "supervisor",
    due_in_days: 14,
  },
]

/**
 * ¿Es una regla de contexto (categoría "*")? Sus correlaciones solo informan:
 * se muestran como evidencia en el panel del hallazgo, pero no generan tareas
 * sugeridas ni suben su prioridad por la severidad del hallazgo.
 */
export function isContextRule(ruleId: string): boolean {
  return CORRELATION_RULES.some((r) => r.id === ruleId && r.categories.includes("*"))
}
