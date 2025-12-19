-- Tabla de proyectos/obras
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  client VARCHAR(255),
  start_date DATE,
  end_date DATE,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de personal/trabajadores
CREATE TABLE workers (
  id SERIAL PRIMARY KEY,
  rut VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role VARCHAR(100),
  company VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(255),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de tipos de documentos
CREATE TABLE document_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  validity_days INTEGER,
  is_mandatory BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de documentos
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
  document_type_id INTEGER REFERENCES document_types(id) ON DELETE SET NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT,
  issue_date DATE,
  expiry_date DATE,
  status VARCHAR(50) DEFAULT 'valid',
  extracted_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de categorías de checklists
CREATE TABLE checklist_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de plantillas de checklists
CREATE TABLE checklist_templates (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES checklist_categories(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  items JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de checklists completados
CREATE TABLE completed_checklists (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  inspector_name VARCHAR(255),
  location VARCHAR(255),
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responses JSONB NOT NULL,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de hallazgos
CREATE TABLE findings (
  id SERIAL PRIMARY KEY,
  checklist_id INTEGER REFERENCES completed_checklists(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  severity VARCHAR(50) NOT NULL,
  location VARCHAR(255),
  responsible_person VARCHAR(255),
  due_date DATE,
  resolved_at TIMESTAMP,
  resolution_notes TEXT,
  photos JSONB,
  status VARCHAR(50) DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de informes generados
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  report_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  date_from DATE,
  date_to DATE,
  content JSONB,
  file_url TEXT,
  generated_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de notificaciones
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  related_id INTEGER,
  related_type VARCHAR(50),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar performance
CREATE INDEX idx_workers_project ON workers(project_id);
CREATE INDEX idx_workers_rut ON workers(rut);
CREATE INDEX idx_documents_worker ON documents(worker_id);
CREATE INDEX idx_documents_expiry ON documents(expiry_date);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_findings_project ON findings(project_id);
CREATE INDEX idx_findings_status ON findings(status);
CREATE INDEX idx_findings_severity ON findings(severity);
CREATE INDEX idx_completed_checklists_project ON completed_checklists(project_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);

-- Tabla de planos
CREATE TABLE plans (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  plan_type VARCHAR(50) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT,
  mime_type VARCHAR(100),
  extracted JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de pisos asociados a un plano
CREATE TABLE plan_floors (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  level INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de zonas por piso o generales del plano
CREATE TABLE plan_zones (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
  floor_id INTEGER REFERENCES plan_floors(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50),
  zone_type VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para planos
CREATE INDEX idx_plans_project ON plans(project_id);
CREATE INDEX idx_plan_floors_plan ON plan_floors(plan_id);
CREATE INDEX idx_plan_zones_plan ON plan_zones(plan_id);
CREATE INDEX idx_plan_zones_floor ON plan_zones(floor_id);

-- Tabla de amonestaciones (cartas de amonestación)
CREATE TABLE admonitions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  worker_id INTEGER REFERENCES workers(id) ON DELETE CASCADE,
  admonition_date DATE NOT NULL,
  admonition_type VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  supervisor_signature TEXT,
  attachments JSONB,
  status VARCHAR(50) DEFAULT 'active',
  approval_status VARCHAR(50) DEFAULT 'pending',
  approved_at TIMESTAMP,
  rejected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admonitions_worker ON admonitions(worker_id);
CREATE INDEX idx_admonitions_type ON admonitions(admonition_type);
CREATE INDEX idx_admonitions_status ON admonitions(status);
CREATE INDEX idx_admonitions_approval ON admonitions(approval_status);
CREATE INDEX idx_admonitions_date ON admonitions(admonition_date);
