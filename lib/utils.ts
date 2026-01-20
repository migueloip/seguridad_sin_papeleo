import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeRut(rut: string) {
  const cleaned = rut.replace(/[^0-9kK]/g, "").toUpperCase()
  const body = cleaned.slice(0, -1)
  const dv = cleaned.slice(-1)
  return `${body}-${dv}`
}

export function formatRut(rut: string) {
  const normalized = normalizeRut(rut)
  const [body, dv] = normalized.split("-")
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${withDots}-${dv}`
}

export function isValidRut(rut: string) {
  const m = rut.match(/^([0-9]+)-([0-9K])$/)
  if (!m) return false
  const body = m[1]
  const dv = m[2]
  let sum = 0
  let mul = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const mod = 11 - (sum % 11)
  const calc = mod === 11 ? "0" : mod === 10 ? "K" : String(mod)
  return calc === dv
}

export function normalizeDate(input: string | null) {
  if (!input) return undefined
  const s = input.trim()
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (ymd) {
    const y = ymd[1]
    const m = ymd[2].padStart(2, "0")
    const d = ymd[3].padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (dmy) {
    const d = dmy[1].padStart(2, "0")
    const m = dmy[2].padStart(2, "0")
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    return `${y}-${m}-${d}`
  }
  return s
}

export function toOptionalDate(input?: string | Date | null): Date | null {
  if (input === undefined || input === null) return null
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input
  }
  const normalized = normalizeDate(String(input)) || String(input)
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2]) - 1
    const d = Number(m[3])
    const date = new Date(y, mo, d)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}
