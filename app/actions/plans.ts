"use server"

import { sql } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { PlanData } from "@/components/plans-3d/types"
import { Plan, PlanFloor, PlanZone, PlanType } from "@/lib/db"
import { revalidatePath } from "next/cache"

// --- NEW 3D AI Action ---

export async function processPlanWithAI(fileUrl: string): Promise<PlanData> {
  // Simulator for AI processing delay
  await new Promise((resolve) => setTimeout(resolve, 2000))

  return {
    width: 20,
    height: 15,
    scale: 100,
    walls: [
      { id: "w1", start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, height: 3, thickness: 0.2 },
      { id: "w2", start: { x: 20, y: 0 }, end: { x: 20, y: 15 }, height: 3, thickness: 0.2 },
      { id: "w3", start: { x: 20, y: 15 }, end: { x: 0, y: 15 }, height: 3, thickness: 0.2 },
      { id: "w4", start: { x: 0, y: 15 }, end: { x: 0, y: 0 }, height: 3, thickness: 0.2 },
      { id: "w5", start: { x: 0, y: 5 }, end: { x: 10, y: 5 }, height: 3, thickness: 0.15 },
      { id: "w6", start: { x: 10, y: 5 }, end: { x: 10, y: 0 }, height: 3, thickness: 0.15 },
    ],
    layers: [
      { id: "l1", name: "Estructura", type: "infrastructure", visible: true, color: "#94a3b8", elements: [] },
      { id: "l2", name: "Electricidad", type: "infrastructure", visible: false, color: "#fbbf24", elements: [] }
    ],
    zones: [
      {
        id: "z1",
        name: "Zona Alta Tensión",
        riskLevel: "critical",
        score: 95,
        polygon: [{ x: 15, y: 2 }, { x: 19, y: 2 }, { x: 19, y: 6 }, { x: 15, y: 6 }]
      },
      {
        id: "z2",
        name: "Pasillo Principal",
        riskLevel: "low",
        score: 10,
        polygon: [{ x: 2, y: 6 }, { x: 18, y: 6 }, { x: 18, y: 9 }, { x: 2, y: 9 }]
      }
    ]
  }
}

export async function getPlans(projectId?: number) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  if (projectId) {
    return await Promise.resolve(sql<Plan[]>`SELECT * FROM plans WHERE user_id = ${userId} AND project_id = ${projectId} ORDER BY created_at DESC`);
  } else {
    return await Promise.resolve(sql<Plan[]>`SELECT * FROM plans WHERE user_id = ${userId} ORDER BY created_at DESC`);
  }
}


// --- Legacy Actions (Restored) ---

export async function extractZonesFromPlan(base64: string, mime: string) {
  // Mock implementation consistent with previous functionality expectation
  await new Promise(resolve => setTimeout(resolve, 1000));
  return {
    floors: [
      {
        name: "General",
        zones: [],
        frame: { x: 0, y: 0, width: 1, height: 1 }
      }
    ]
  }
}

export async function createPlan(data: Partial<Plan>) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");

  const [newPlan] = await (sql<Plan[]>`
    INSERT INTO plans (
      user_id, project_id, name, plan_type, file_name, file_url, mime_type, extracted, created_at, updated_at
    ) VALUES (
      ${userId}, ${data.project_id || null}, ${data.name || "Sin nombre"}, ${data.plan_type || "General"}, 
      ${data.file_name || ""}, ${data.file_url || null}, ${data.mime_type || null}, ${data.extracted ? sql.json(data.extracted as any) : null},
      NOW(), NOW()
    )
    RETURNING *
  ` as Promise<Plan[]>);
  return newPlan;
}

export async function savePlanFloorsAndZones(planId: number, floors: any[]) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");

  // Simple transaction simulation: delete old, insert new
  // Note: 'postgres' library usually handles transactions via sql.begin but we'll stick to simple queries for restore
  // Deleting existing structure for this plan to replace with new state

  // First get or create floors and zones. 
  // Since the UI seems to send a full JSON blob, we might just store it in 'extracted' column of plans table 
  // OR if we have real tables plan_floors and plan_zones (which defined in db.ts), we should populate them.

  // Checking db.ts... yes, PlanFloor and PlanZone exist.

  await sql`DELETE FROM plan_zones WHERE plan_id = ${planId}`;
  await sql`DELETE FROM plan_floors WHERE plan_id = ${planId}`;

  for (const floor of floors) {
    const [savedFloor] = await Promise.resolve(sql<PlanFloor[]>`
      INSERT INTO plan_floors (user_id, plan_id, name, level)
      VALUES (${userId}, ${planId}, ${floor.name}, ${floor.level || 0})
      RETURNING *
    `);

    if (savedFloor && floor.zones) {
      for (const zone of floor.zones) {
        await sql`
          INSERT INTO plan_zones (user_id, plan_id, floor_id, name, code, zone_type)
          VALUES (${userId}, ${planId}, ${savedFloor.id}, ${zone.name}, ${zone.code}, ${zone.type || 'general'})
        `;
      }
    }
  }

  // Also update extracted column for quick access if needed
  await sql`
    UPDATE plans SET extracted = ${sql.json({ floors })}, updated_at = NOW() WHERE id = ${planId}
  `;

  revalidatePath("/proyectos");
}

export async function getPlanDetail(planId: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");

  const [plan] = await Promise.resolve(sql<Plan[]>`SELECT * FROM plans WHERE id = ${planId}`);
  if (!plan) return { plan: null, floors: [] };

  const floors = await Promise.resolve(sql<PlanFloor[]>`SELECT * FROM plan_floors WHERE plan_id = ${planId} ORDER BY id`);
  const zones = await Promise.resolve(sql<PlanZone[]>`SELECT * FROM plan_zones WHERE plan_id = ${planId}`);

  // Reconstruct structure
  const resultFloors = floors.map(f => ({
    ...f,
    zones: zones.filter(z => z.floor_id === f.id)
  }));

  // If no relational data, check JSON
  if (resultFloors.length === 0 && plan.extracted && (plan.extracted as any).floors) {
    return { plan, floors: (plan.extracted as any).floors };
  }

  return { plan, floors: resultFloors };
}

export async function deletePlan(planId: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");
  await sql`DELETE FROM plans WHERE id = ${planId}`;
  revalidatePath("/proyectos");
}

export async function getPlanTypes() {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  return await Promise.resolve(sql<PlanType[]>`SELECT * FROM plan_types ORDER BY name`);
}

export async function createPlanType(data: { name: string; description?: string }) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");
  await sql`INSERT INTO plan_types (user_id, name, description) VALUES (${userId}, ${data.name}, ${data.description || null})`;
  revalidatePath("/proyectos");
}

export async function updatePlanType(id: number, data: { name: string; description?: string }) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");
  await sql`UPDATE plan_types SET name = ${data.name}, description = ${data.description || null} WHERE id = ${id}`;
  revalidatePath("/proyectos");
}

export async function deletePlanType(id: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");
  await sql`DELETE FROM plan_types WHERE id = ${id}`;
  revalidatePath("/proyectos");
}

export async function getPlanZonesByProject(projectId?: number) {
  const userId = await getCurrentUserId()
  if (!userId) return []

  // Join plans, floors, and zones to get full context
  // If projectId is provided, filter by it. Otherwise show all for user (or filter by user? usually by project context)

  if (projectId) {
    return await sql`
      SELECT 
        pz.id, 
        pz.name, 
        pz.code, 
        pf.name as floor_name, 
        p.name as plan_name,
        p.project_id
      FROM plan_zones pz
      JOIN plan_floors pf ON pz.floor_id = pf.id
      JOIN plans p ON pz.plan_id = p.id
      WHERE p.project_id = ${projectId} AND p.user_id = ${userId}
      ORDER BY p.name, pf.level, pz.name
    `
  } else {
    // If no project specified, maybe return all user's zones? Or empty?
    // Safer to return user's zones
    return await sql`
      SELECT 
        pz.id, 
        pz.name, 
        pz.code, 
        pf.name as floor_name, 
        p.name as plan_name,
        p.project_id
      FROM plan_zones pz
      JOIN plan_floors pf ON pz.floor_id = pf.id
      JOIN plans p ON pz.plan_id = p.id
      WHERE p.user_id = ${userId}
      ORDER BY p.project_id, p.name, pf.level, pz.name
    `
  }
}

export async function updatePlanData(planId: number, data: any) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("No autenticado");

  await sql`
    UPDATE plans SET extracted = ${sql.json(data)}, updated_at = NOW() WHERE id = ${planId} AND user_id = ${userId}
  `;
  revalidatePath("/proyectos");
}
