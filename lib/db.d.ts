import { type Sql } from "postgres"

declare module "postgres" {
  interface Sql {
    <T = unknown>( literals: TemplateStringsArray, ...args: unknown[] ): Promise<T[]  // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}