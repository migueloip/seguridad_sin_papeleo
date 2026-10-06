import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { OBRA_SCHEMA_STATEMENTS, renderObraSchemaSql } from "./schema"

const SQL_FILE = path.resolve(__dirname, "../../scripts/006-obra-integral.sql")

describe("esquema obra", () => {
  it("scripts/006-obra-integral.sql está sincronizado con lib/obra/schema.ts", () => {
    const expected = renderObraSchemaSql()
    if (process.env.UPDATE_OBRA_SQL === "1") {
      fs.writeFileSync(SQL_FILE, expected)
    }
    expect(fs.readFileSync(SQL_FILE, "utf8")).toBe(expected)
  })

  it("todas las sentencias son idempotentes", () => {
    for (const s of OBRA_SCHEMA_STATEMENTS) {
      // Los backfills de datos se re-ejecutan sin efecto porque su WHERE excluye lo ya corregido.
      if (/^UPDATE /.test(s)) expect(s).toMatch(/\bWHERE\b/)
      else expect(s).toMatch(/IF NOT EXISTS/)
    }
  })
})
