import "postgres"

declare module "postgres" {
  interface Sql {
    <T extends readonly unknown[]>(template: TemplateStringsArray, ...args: unknown[]): Promise<T>
    <T extends object>(template: TemplateStringsArray, ...args: unknown[]): Promise<T[]>
  }
}