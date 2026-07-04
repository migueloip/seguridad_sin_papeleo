-- ============================================================================
-- Migración 005 — Defensa en profundidad (RLS) + soft-delete para evidencias
-- ============================================================================
--
-- IMPORTANTE: Esta migración se aplica MANUALMENTE en Supabase SQL Editor.
-- No se ejecuta desde la app. Léela completa antes de correr.
--
-- Cambios:
--   1. Habilita Row Level Security (RLS) en las tablas que ya tienen user_id
--      desde la migración 004. Cada usuario solo puede ver/modificar sus
--      propios registros. Sin esto, un bug que olvide `WHERE user_id = ${id}`
--      en un server action expone datos cross-tenant.
--
--   2. Convierte `documents.worker_id` y `documents.user_id` de ON DELETE
--      CASCADE a ON DELETE RESTRICT — los documentos son evidencia legal de
--      prevención de riesgos en obras y no deben desaparecer al borrar al
--      trabajador o al usuario que los subió.
--
--   3. Añade `deleted_at TIMESTAMP NULL` a `documents`, `workers`,
--      `findings` para soft-delete. Los DELETE en la app se convierten en
--      UPDATE deleted_at = NOW().
--
-- Si tu app usa el SERVICE_KEY de Supabase para todos los queries (lo cual
-- bypasa RLS), las políticas no aplicarán hasta que migres a JWT por usuario.
-- En ese caso, las políticas son de defensa para cuando migres al patrón
-- correcto.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RLS habilitado en tablas multi-tenant
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS workers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS mobile_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS findings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS completed_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reports              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS plans                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS admonitions          ENABLE ROW LEVEL SECURITY;

-- Política genérica: el usuario actual de Supabase (auth.uid()) accede solo a
-- sus propios registros. Asumimos que `user_id` mapea al uid de Supabase.
-- Si tu app aún no usa Supabase Auth (solo sesiones propias en tabla
-- `sessions`), estas políticas serán defensa pasiva — el SERVICE_KEY las
-- bypasa.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'projects', 'workers', 'documents', 'mobile_documents', 'findings',
    'completed_checklists', 'reports', 'plans', 'settings', 'admonitions'
  ])
  LOOP
    -- Borrar política previa si existe (idempotencia)
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       USING (user_id = (current_setting(''app.current_user_id'', true))::int)
       WITH CHECK (user_id = (current_setting(''app.current_user_id'', true))::int)',
      t
    );
  END LOOP;
END $$;

-- Para usar las políticas desde la app:
-- Antes de cada query, ejecutar:
--   SELECT set_config('app.current_user_id', '<userId>', true);
-- En `lib/db.ts`, envolver el cliente postgres con un middleware que setea
-- esto al inicio de cada transacción.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Documentos: CASCADE → RESTRICT (evidencia legal)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS documents
  DROP CONSTRAINT IF EXISTS documents_worker_id_fkey;
ALTER TABLE IF EXISTS documents
  ADD CONSTRAINT documents_worker_id_fkey
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE RESTRICT;

ALTER TABLE IF EXISTS documents
  DROP CONSTRAINT IF EXISTS documents_user_id_fkey;
ALTER TABLE IF EXISTS documents
  ADD CONSTRAINT documents_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Soft-delete en tablas con valor de auditoría
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS documents
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS workers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS findings
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE IF EXISTS admonitions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_documents_deleted_at   ON documents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_workers_deleted_at     ON workers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_findings_deleted_at    ON findings(deleted_at);
CREATE INDEX IF NOT EXISTS idx_admonitions_deleted_at ON admonitions(deleted_at);

COMMIT;

-- Pasos siguientes a nivel app (NO incluidos en este SQL):
--  1. Cambiar DELETE FROM <tabla> a UPDATE <tabla> SET deleted_at = NOW().
--  2. Agregar WHERE deleted_at IS NULL a todos los SELECT existentes.
--  3. Si se quiere usar RLS de verdad: setear `app.current_user_id` en
--     lib/db.ts antes de cada query (ver comentario arriba).
