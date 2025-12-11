-- Tabla de configuracion del sistema
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar configuracion por defecto
INSERT INTO settings (key, value, description) VALUES 
  ('ai_provider', 'openai', 'Proveedor de IA para OCR e informes'),
  ('ai_model', 'gpt-4o-mini', 'Modelo de IA a usar'),
  ('ai_api_key', '', 'API Key del proveedor de IA'),
  ('ocr_method', 'tesseract', 'Metodo de OCR: tesseract o ai'),
  ('company_name', 'SafeWork Pro', 'Nombre de la empresa'),
  ('company_logo', '', 'URL del logo de la empresa')
ON CONFLICT (key) DO NOTHING;
