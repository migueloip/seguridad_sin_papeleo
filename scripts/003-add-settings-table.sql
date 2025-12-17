-- Tabla de configuracion del sistema
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) NOT NULL,
  value TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS settings ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS settings DROP CONSTRAINT IF EXISTS settings_key_key;
ALTER TABLE IF EXISTS settings ADD CONSTRAINT settings_user_key UNIQUE (user_id, key);

-- Insertar configuracion por defecto
INSERT INTO settings (user_id, key, value, description)
SELECT NULL, 'ai_provider', 'google', 'Proveedor de IA para OCR e informes'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_provider');
INSERT INTO settings (user_id, key, value, description)
SELECT NULL, 'ai_model', 'gemini-2.5-flash', 'Modelo de IA a usar'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_model');
INSERT INTO settings (user_id, key, value, description)
SELECT NULL, 'ai_api_key', '', 'API Key del proveedor de IA'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ai_api_key');
INSERT INTO settings (user_id, key, value, description)
SELECT NULL, 'ocr_method', 'tesseract', 'Metodo de OCR: tesseract o ai'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'ocr_method');
INSERT INTO settings (user_id, key, value, description)
SELECT NULL, 'company_name', 'SafeWork Pro', 'Nombre de la empresa'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'company_name');
INSERT INTO settings (user_id, key, value, description)
SELECT NULL, 'company_logo', '', 'URL del logo de la empresa'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id IS NULL AND key = 'company_logo');
