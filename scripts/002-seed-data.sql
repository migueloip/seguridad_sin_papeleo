-- Insertar tipos de documentos comunes en SSL
INSERT INTO document_types (name, description, validity_days, is_mandatory) VALUES
('Cédula de Identidad', 'Documento de identificación personal', 3650, true),
('Licencia de Conducir', 'Licencia para conducir vehículos', 1825, false),
('Certificado ODI', 'Obligación de Informar riesgos laborales', 365, true),
('Examen Preocupacional', 'Examen médico de ingreso', 365, true),
('Curso Altura Física', 'Certificación trabajo en altura', 730, false),
('Curso Rigger', 'Certificación para maniobras de izaje', 730, false),
('Certificado AFP', 'Cotizaciones previsionales', 30, true),
('Certificado Salud', 'Cotizaciones de salud', 30, true),
('Contrato de Trabajo', 'Contrato laboral vigente', NULL, true),
('Anexo de Contrato', 'Anexos al contrato de trabajo', NULL, false),
('Credencial Mutual', 'Credencial de mutual de seguridad', 365, true),
('Curso Operador Grúa', 'Certificación operador de grúa', 730, false);

-- Insertar categorías de checklists
INSERT INTO checklist_categories (name, description) VALUES
('Inspecciones Diarias', 'Checklists para inspecciones rutinarias diarias'),
('Equipos y Maquinaria', 'Inspección de equipos y maquinaria'),
('EPP', 'Verificación de equipos de protección personal'),
('Andamios y Escaleras', 'Inspección de estructuras temporales'),
('Excavaciones', 'Control de excavaciones y zanjas'),
('Trabajo en Altura', 'Verificación de condiciones para trabajo en altura'),
('Soldadura y Oxicorte', 'Control de trabajos en caliente'),
('Espacios Confinados', 'Verificación para ingreso a espacios confinados');

-- Insertar plantillas de checklists
INSERT INTO checklist_templates (category_id, name, description, items) VALUES
(1, 'Inspección Diaria de Obra', 'Checklist general para inspección diaria de la obra', 
'[
  {"id": 1, "text": "Accesos despejados y señalizados", "category": "Accesos"},
  {"id": 2, "text": "Señalética de seguridad visible y en buen estado", "category": "Señalización"},
  {"id": 3, "text": "Extintores accesibles y con carga vigente", "category": "Emergencia"},
  {"id": 4, "text": "Orden y limpieza general del área", "category": "Orden"},
  {"id": 5, "text": "Baños químicos en condiciones higiénicas", "category": "Instalaciones"},
  {"id": 6, "text": "Comedores limpios y ordenados", "category": "Instalaciones"},
  {"id": 7, "text": "Botiquín de primeros auxilios completo", "category": "Emergencia"},
  {"id": 8, "text": "Personal con EPP completo", "category": "EPP"},
  {"id": 9, "text": "Protecciones colectivas instaladas", "category": "Protecciones"},
  {"id": 10, "text": "Tableros eléctricos cerrados y señalizados", "category": "Eléctrico"}
]'),
(3, 'Verificación de EPP', 'Control de uso correcto de equipos de protección personal',
'[
  {"id": 1, "text": "Casco de seguridad en buen estado", "category": "Cabeza"},
  {"id": 2, "text": "Barbiquejo colocado correctamente", "category": "Cabeza"},
  {"id": 3, "text": "Lentes de seguridad sin rayaduras", "category": "Ojos"},
  {"id": 4, "text": "Protección auditiva cuando corresponde", "category": "Oídos"},
  {"id": 5, "text": "Guantes apropiados para la tarea", "category": "Manos"},
  {"id": 6, "text": "Calzado de seguridad con punta de acero", "category": "Pies"},
  {"id": 7, "text": "Chaleco reflectante visible", "category": "Cuerpo"},
  {"id": 8, "text": "Arnés de seguridad en trabajo en altura", "category": "Altura"},
  {"id": 9, "text": "Ropa de trabajo adecuada", "category": "Cuerpo"},
  {"id": 10, "text": "Protección respiratoria cuando corresponde", "category": "Respiración"}
]'),
(4, 'Inspección de Andamios', 'Verificación de condiciones de andamios',
'[
  {"id": 1, "text": "Base nivelada y estable", "category": "Estructura"},
  {"id": 2, "text": "Arriostramientos instalados", "category": "Estructura"},
  {"id": 3, "text": "Plataformas completas sin huecos", "category": "Plataforma"},
  {"id": 4, "text": "Barandas superiores a 1 metro", "category": "Protección"},
  {"id": 5, "text": "Baranda intermedia instalada", "category": "Protección"},
  {"id": 6, "text": "Rodapié en todo el perímetro", "category": "Protección"},
  {"id": 7, "text": "Escalera de acceso segura", "category": "Acceso"},
  {"id": 8, "text": "Tarjeta de inspección vigente", "category": "Documentación"},
  {"id": 9, "text": "Sin sobrecargas de material", "category": "Carga"},
  {"id": 10, "text": "Alejado de líneas eléctricas", "category": "Eléctrico"}
]'),
(6, 'Permiso Trabajo en Altura', 'Verificación antes de trabajo en altura sobre 1.8m',
'[
  {"id": 1, "text": "Personal capacitado y certificado", "category": "Personal"},
  {"id": 2, "text": "Examen de altura física vigente", "category": "Documentación"},
  {"id": 3, "text": "Arnés de seguridad inspeccionado", "category": "EPP"},
  {"id": 4, "text": "Línea de vida instalada y certificada", "category": "Sistema"},
  {"id": 5, "text": "Punto de anclaje resistente (22kN)", "category": "Sistema"},
  {"id": 6, "text": "Área inferior acordonada", "category": "Zona"},
  {"id": 7, "text": "Condiciones climáticas favorables", "category": "Ambiente"},
  {"id": 8, "text": "Comunicación con supervisor establecida", "category": "Comunicación"},
  {"id": 9, "text": "Plan de rescate definido", "category": "Emergencia"},
  {"id": 10, "text": "Herramientas amarradas", "category": "Herramientas"}
]');

-- Insertar proyecto de ejemplo
INSERT INTO projects (name, location, client, start_date, status) VALUES
('Edificio Corporativo Central', 'Av. Providencia 1234, Santiago', 'Inmobiliaria ABC', '2024-01-15', 'active'),
('Ampliación Planta Industrial', 'Ruta 5 Norte Km 45, Lampa', 'Industrias XYZ', '2024-03-01', 'active');

-- Insertar trabajadores de ejemplo
INSERT INTO workers (rut, first_name, last_name, role, company, phone, email, project_id, status) VALUES
('12.345.678-9', 'Juan', 'Pérez González', 'Maestro Albañil', 'Constructora Principal', '+56912345678', 'juan.perez@email.com', 1, 'active'),
('13.456.789-0', 'María', 'López Silva', 'Operadora Grúa', 'Constructora Principal', '+56923456789', 'maria.lopez@email.com', 1, 'active'),
('14.567.890-1', 'Carlos', 'Rodríguez Muñoz', 'Electricista', 'Subcontrato Eléctrico', '+56934567890', 'carlos.rodriguez@email.com', 1, 'active'),
('15.678.901-2', 'Ana', 'Martínez Soto', 'Soldador', 'Subcontrato Metálico', '+56945678901', 'ana.martinez@email.com', 1, 'active'),
('16.789.012-3', 'Pedro', 'García Vera', 'Jornalero', 'Constructora Principal', '+56956789012', 'pedro.garcia@email.com', 2, 'active');

-- Insertar documentos de ejemplo
INSERT INTO documents (worker_id, document_type_id, file_name, issue_date, expiry_date, status) VALUES
(1, 1, 'cedula_juan_perez.pdf', '2020-05-15', '2030-05-15', 'valid'),
(1, 3, 'odi_juan_perez.pdf', '2024-01-20', '2025-01-20', 'valid'),
(1, 4, 'examen_juan_perez.pdf', '2024-01-15', '2025-01-15', 'valid'),
(2, 1, 'cedula_maria_lopez.pdf', '2019-08-10', '2029-08-10', 'valid'),
(2, 3, 'odi_maria_lopez.pdf', '2024-02-01', '2025-02-01', 'valid'),
(2, 12, 'curso_grua_maria.pdf', '2023-06-15', '2025-06-15', 'valid'),
(3, 1, 'cedula_carlos_rodriguez.pdf', '2021-03-20', '2031-03-20', 'valid'),
(3, 3, 'odi_carlos_rodriguez.pdf', '2023-11-15', '2024-11-15', 'expiring'),
(4, 1, 'cedula_ana_martinez.pdf', '2018-12-01', '2028-12-01', 'valid'),
(4, 5, 'altura_ana_martinez.pdf', '2023-03-10', '2025-03-10', 'valid'),
(5, 1, 'cedula_pedro_garcia.pdf', '2022-07-25', '2032-07-25', 'valid'),
(5, 3, 'odi_pedro_garcia.pdf', '2024-03-01', '2025-03-01', 'valid');

-- Insertar hallazgos de ejemplo
INSERT INTO findings (project_id, title, description, severity, location, responsible_person, due_date, status) VALUES
(1, 'Falta señalización en excavación', 'Se detectó excavación sin señalización perimetral ni cinta de peligro', 'high', 'Sector A - Excavación fundaciones', 'Juan Pérez', '2024-12-10', 'open'),
(1, 'Extintores sin inspección mensual', 'Los extintores del sector B no tienen registro de inspección del mes actual', 'medium', 'Sector B - Bodega', 'Carlos Rodríguez', '2024-12-15', 'open'),
(1, 'Trabajador sin casco', 'Se observó trabajador en área de maniobras sin casco de seguridad', 'high', 'Sector C - Zona de descarga', 'Supervisor de turno', '2024-12-08', 'resolved'),
(2, 'Cables eléctricos expuestos', 'Cables de alimentación temporal sin protección mecánica', 'critical', 'Área de montaje', 'Pedro García', '2024-12-09', 'open'),
(2, 'Andamio sin tarjeta de inspección', 'Andamio en uso sin tarjeta verde de autorización', 'high', 'Fachada norte', 'Ana Martínez', '2024-12-11', 'in_progress');

-- Insertar notificaciones de ejemplo
INSERT INTO notifications (type, title, message, related_id, related_type, is_read) VALUES
('expiring', 'Documento por vencer', 'El ODI de Carlos Rodríguez vence en 15 días', 8, 'document', false),
('finding', 'Nuevo hallazgo crítico', 'Se registró hallazgo crítico: Cables eléctricos expuestos', 4, 'finding', false),
('finding', 'Hallazgo resuelto', 'Se cerró el hallazgo: Trabajador sin casco', 3, 'finding', true);
