
import { streamText, tool, convertToModelMessages, type UIMessage, type ToolExecutionOptions } from 'ai';
import { getModel } from '@/lib/ai';
import { getSetting } from '@/app/actions/settings';
import { getReportData } from '@/app/actions/reports';
import { z } from 'zod';

const queryProjectDataParams = z.object({
    dataType: z.enum(["findings", "documents", "workers", "summary"]).describe("Tipo de datos a consultar"),
    period: z.enum(["weekly", "monthly", "all"]).optional().default("monthly").describe("Periodo de tiempo")
});

const generateReportElementParams = z.object({
    type: z.enum(["simple_section", "table", "matrix", "list", "heading", "plain_text"]).describe("Tipo de elemento"),
    title: z.string().optional().describe("Título del elemento (opcional según tipo)"),
    content: z.string().optional().describe("Contenido principal. Si es simple_section es el body. Si es plain_text es el texto."),
    data: z.string().optional().describe("JSON stringified con datos estructurados para tablas, matrices o listas."),
    instructions: z.string().optional().describe("Breve descripción de lo que hiciste para el usuario")
});

export const maxDuration = 30;

export async function POST(req: Request) {
    const { messages, projectId } = await req.json() as { messages: UIMessage[]; projectId?: number };

    const apiKey = await getSetting("ai_api_key");
    const aiModel = (await getSetting("ai_model")) || "gemini-1.5-flash";

    if (!apiKey) {
        return new Response("AI API Key not configured", { status: 400 });
    }

    const model = getModel("google", aiModel, apiKey);

    // Sistema de contexto
    const systemPrompt = `Eres un asistente experto en Prevención de Riesgos de Chile y un diseñador de informes técnicos profesional.
  Estás asisitiendo al usuario dentro de un "Editor de PDF" para crear informes de seguridad.
  
  TU TRABAJO:
  1. Dialogar con el usuario para entender qué necesita en su informe.
  2. Consultar datos reales del proyecto usando la herramienta "queryProjectData".
  3. Crear elementos visuales para el informe (tablas, secciones, matrices) usando la herramienta "generateReportElement".
  
  REGLAS DE ORO:
  - NO inventes datos. Si te piden "tabla de hallazgos", PRIMERO consulta los hallazgos con "queryProjectData" y LUEGO crea la tabla con esos datos exactos.
  - El usuario ve tu chat a la izquierda y el documento a la derecha. Cuando uses "generateReportElement", el elemento aparecerá mágicamente en el documento.
  - Sé proactivo. Si ves muchos hallazgos críticos, sugiere crear una sección de "Alertas Críticas".
  - Usa formato Markdown en tus respuestas de chat.
  - Al generar tablas o matrices, asegúrate de que el contenido sea breve y profesional.
  `;

    const result = streamText({
        model,
        system: systemPrompt,
        messages: await convertToModelMessages(messages),
        tools: {
            queryProjectData: tool({
                description: "Obtener datos reales del proyecto actual: Hallazgos, Documentos, Trabajadores o Resumen General.",
                parameters: queryProjectDataParams,
                execute: async (
                    { dataType, period }: z.infer<typeof queryProjectDataParams>,
                    _options: ToolExecutionOptions,
                ) => {
                    const data = await getReportData(period, projectId);
                    if (dataType === "findings") {
                        return {
                            total: data.findings.total,
                            recent: data.recentFindings.slice(0, 10),
                            stats: data.findings,
                        };
                    }
                    if (dataType === "documents") {
                        return {
                            stats: data.documents,
                            expiring: data.expiringDocuments.slice(0, 10),
                        };
                    }
                    if (dataType === "workers") return data.workers;
                    return data;
                },
            }),
            generateReportElement: tool({
                description: "Crear un nuevo elemento visual para agregar al informe. Úsalo cuando el usuario pida agregar algo.",
                parameters: generateReportElementParams,
                execute: async (
                    args: z.infer<typeof generateReportElementParams>,
                    _options: ToolExecutionOptions,
                ) => {
                    return {
                        _action: "CREATE_ELEMENT",
                        elementData: args,
                    };
                },
            })
        },
    });

    return result.toUIMessageStreamResponse();
}
