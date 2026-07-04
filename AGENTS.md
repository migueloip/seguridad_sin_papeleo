# AGENTS.md - Seguridad Sin Papeleo

## Dev Commands
- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run lint` - Run ESLint
- `npm run test` - Run vitest (not jest)

## Required Environment Variables
```
DATABASE_URL=
DIRECT_URL=
ADMIN_PASSWORD=
CONFIG_ENCRYPTION_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

## Testing
- Uses **vitest** (not jest)
- Test files: `*.test.ts`, `*.test.tsx`
- Run single test: `npx vitest run lib/utils.test.ts`

## Dependencies
- Next.js 16 + React 19
- Supabase (PostgreSQL)
- Tailwind CSS 4
- shadcn/ui (Radix UI primitives)
- Server Actions (`app/actions/*`)
- PDF parsing: pdfjs-dist
- OCR: tesseract.js
- 3D: react-three/fiber, three.js
- 2D canvas: konva
- AI: @ai-sdk/google

## Build & Deploy
- `npm run build` produces `.next` directory
- Deployed on Netlify (see `netlify.toml`)
- Ignore generated 3D files: `public/architect3d/**`

## Database
- SQL migrations in `scripts/*.sql` (001-005)
- Provider: **Supabase** (Postgres) — el `lib/db.ts` detecta hostnames de
  Supabase pooler / db.*.supabase.co y aplica `sslmode=require` y puerto 6543
  automáticamente.
- También compatible con **Neon** — el wrapper `withRetry` en
  `app/actions/auth.ts` maneja los errores típicos de Neon (`P1017`,
  "Tenant or user not found") con reintentos. Si migras solo a Supabase, ese
  retry sigue siendo útil para reconexiones del pooler.
- Driver: `postgres` v3 (no Prisma, no Drizzle). Las queries usan template
  literals con parametrización: `sql\`SELECT ... WHERE x = ${value}\``. Nunca
  concatenar strings.
- Tables: projects, workers, documents, findings, plans, reports, etc.

## Deploy
- `netlify.toml` configura el build para Netlify. Si despliegas en Vercel o
  similar, ajustar variables `NEXT_PUBLIC_*` según el provider de Vercel.
- El script `scripts/patch-pascal.mjs` corre como `postinstall` y parchea
  `@pascal-app/viewer` para (a) inicializar WebGPU antes del primer render y
  (b) servir assets de `/items/*` desde el origen local en vez de la CDN
  oficial `editor.pascal.app`.

## Codebase Structure
- Components: `components/` + `components/ui/` (shadcn)
- Server Actions: `app/actions/`
- Core logic: `src/`
- Database: `lib/db.ts`
- Auth: `lib/auth.ts`, `lib/mobile-auth.ts`