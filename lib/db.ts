import { PrismaClient } from "@prisma/client"
import { withAccelerate } from "@prisma/extension-accelerate"

const globalForPrisma = globalThis as unknown as { prisma?: any }

const rawUrl = process.env.DATABASE_URL || ""
const l = rawUrl.toLowerCase()
const isAccelerate = !!rawUrl && (l.startsWith("prisma+postgres://") || l.startsWith("prisma://") || l.includes("accelerate.prisma-data.net") || l.includes("db.prisma.io"))
const dbUrl = rawUrl || "postgresql://postgres:postgres@localhost:5432/ssp?schema=public"

process.env.DATABASE_URL = dbUrl
process.env.PRISMA_CLIENT_DATA_PROXY = isAccelerate ? "true" : "false"
if (!isAccelerate) process.env.PRISMA_ACCELERATE_URL = ""

const base = globalForPrisma.prisma ?? new PrismaClient({ log: ["error", "warn"] })
export const prisma = isAccelerate ? base.$extends(withAccelerate()) : base

if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma

export const sql = prisma.$queryRaw.bind(prisma) as unknown as <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>

// Types
export interface Project {
  id: number
  user_id: number
  name: string
  location: string | null
  client: string | null
  start_date: string | null
  end_date: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface Worker {
  id: number
  user_id: number
  rut: string
  first_name: string
  last_name: string
  role: string | null
  company: string | null
  phone: string | null
  email: string | null
  project_id: number | null
  status: string
  created_at: string
  updated_at: string
}

export interface DocumentType {
  id: number
  name: string
  description: string | null
  validity_days: number | null
  is_mandatory: boolean
  created_at: string
}

export interface Document {
  id: number
  user_id: number
  worker_id: number
  document_type_id: number | null
  file_name: string
  file_url: string | null
  issue_date: string | null
  expiry_date: string | null
  status: string
  extracted_data: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface ChecklistCategory {
  id: number
  name: string
  description: string | null
  created_at: string
}

export interface ChecklistTemplate {
  id: number
  category_id: number | null
  name: string
  description: string | null
  items: ChecklistItem[]
  created_at: string
  updated_at: string
}

export interface ChecklistItem {
  id: number
  text: string
  category: string
}

export interface CompletedChecklist {
  id: number
  user_id: number
  template_id: number | null
  project_id: number | null
  inspector_name: string | null
  location: string | null
  completed_at: string
  responses: Record<string, boolean | string>
  notes: string | null
  status: string
  created_at: string
}

export interface Finding {
  id: number
  user_id: number
  checklist_id: number | null
  project_id: number | null
  title: string
  description: string | null
  severity: "low" | "medium" | "high" | "critical"
  location: string | null
  responsible_person: string | null
  due_date: string | null
  resolved_at: string | null
  resolution_notes: string | null
  photos: string[] | null
  status: "open" | "in_progress" | "resolved" | "closed"
  created_at: string
  updated_at: string
}

export interface Report {
  id: number
  user_id: number
  project_id: number | null
  report_type: string
  title: string
  date_from: string | null
  date_to: string | null
  content: Record<string, unknown> | null
  file_url: string | null
  generated_by: string | null
  created_at: string
}

export interface Notification {
  id: number
  type: string
  title: string
  message: string | null
  related_id: number | null
  related_type: string | null
  is_read: boolean
  created_at: string
}

export interface User {
  id: number
  email: string
  name: string | null
  password_hash: string
  role: string
  created_at: string
}

export interface Session {
  id: number
  user_id: number
  token: string
  created_at: string
  expires_at: string
}

export interface Plan {
  id: number
  user_id: number
  project_id: number | null
  name: string
  plan_type: string
  file_name: string
  file_url: string | null
  mime_type: string | null
  extracted: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface PlanFloor {
  id: number
  user_id: number
  plan_id: number
  name: string
  level: number | null
  created_at: string
}

export interface PlanZone {
  id: number
  user_id: number
  plan_id: number
  floor_id: number | null
  name: string
  code: string | null
  zone_type: string | null
  created_at: string
}
