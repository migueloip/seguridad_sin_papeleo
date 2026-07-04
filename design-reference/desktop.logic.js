
class Component extends DCLogic {
  state = {
    screen: 'login',
    section: 'dashboard',
    projectId: 1,
    showNewProject: false,
    aiOpen: false,
    nav: { hallazgos: true, documentos: true, informes: true, personal: true, planos: true, checklists: true },
    // section-local state
    findingFilter: 'todos',
    docFilter: 'todos',
    configTab: 'general',
    selectedZone: 0,
    sigEnabled: true,
    planBuilding: 0,
    planFloorId: 'P7',
    scanning: false,
    scanProgress: 0,
    scanStep: '',
    scanned: { 'A|P7': true, 'A|S2': true, 'B|P3': true },
    mobileUploads: [
      { id: 'M-312', file: 'IMG_2231.jpg', kind: 'photo', uploadedBy: 'Pedro Rojas', time: 'Hoy · 09:42', zone: 'Piso 7 · Ala Norte', type: '', assignee: '', classified: false },
      { id: 'M-311', file: 'cert_altura_scan.pdf', kind: 'pdf', uploadedBy: 'María Soto', time: 'Hoy · 08:15', zone: 'Oficina de terreno', type: '', assignee: '', classified: false },
      { id: 'M-309', file: 'IMG_2228.jpg', kind: 'photo', uploadedBy: 'Luis Vega', time: 'Ayer · 17:50', zone: 'Taller', type: '', assignee: '', classified: false },
      { id: 'M-307', file: 'licencia_d_foto.jpg', kind: 'photo', uploadedBy: 'Luis Vega', time: 'Ayer · 16:02', zone: 'Patio de maniobras', type: 'Licencia conducir clase D', assignee: 'Luis Vega', classified: true },
    ],
    // IA chat page
    iaInput: '',
    iaMessages: [
      { role: 'ai', text: 'Hola Marcela 👋 Soy tu asistente de Easysecure. Puedo responder cualquier cosa sobre este proyecto: hallazgos, documentos y vencimientos, personal, planos de riesgo, informes y cumplimiento. ¿Por dónde partimos?' },
    ],
    // Document editor + its AI chat
    docDraft: { type: '', worker: '', issueDate: '', validity: '', notes: '' },
    docEditTitle: 'Nuevo documento',
    docChatInput: '',
    docChat: [
      { role: 'ai', text: 'Estoy aquí para ayudarte a completar este documento. Dime de qué se trata y lo voy llenando — por ejemplo: «es un curso de trabajo en altura de María Soto, vigencia un año».' },
    ],
  };

  docTypeOptions = ['Curso trabajo en altura', 'Licencia conducir clase D', 'Examen altura física', 'ODI firmada', 'Inducción hombre nuevo', 'Examen ocupacional', 'Certificado de EPP', 'Otro documento'];

  projects = [
    { id: 1, code: 'OBRA-2024-017', name: 'Edificio Vista Norte', location: 'Las Condes, Santiago', progress: 78, statusLabel: 'En ejecución', status: 'active', openFindings: 4, expiringDocs: 5, workers: 48 },
    { id: 2, code: 'OBRA-2025-003', name: 'Ampliación Mall Costanera', location: 'Providencia, Santiago', progress: 45, statusLabel: 'En ejecución', status: 'active', openFindings: 2, expiringDocs: 3, workers: 72 },
    { id: 3, code: 'OBRA-2024-031', name: 'Planta Solar Atacama', location: 'Calama, Antofagasta', progress: 92, statusLabel: 'Cierre', status: 'closing', openFindings: 1, expiringDocs: 1, workers: 26 },
  ];

  findings = [
    { id: 1042, title: 'Andamio sin barandas de protección', desc: 'Andamio en fachada norte sin baranda perimetral ni rodapié en plataforma de trabajo nivel 7.', sev: 'critical', status: 'open', location: 'Piso 7, Ala Norte', zone: 'Ala Norte P7', resp: 'Juan Pérez', days: 3, date: '22 jun 2026', photo: true },
    { id: 1041, title: 'Extintor con carga vencida', desc: 'Extintor PQS de 10kg con última recarga fuera de fecha. Manómetro en zona roja.', sev: 'high', status: 'in_progress', location: 'Bodega 2', zone: 'Bodega 2', resp: 'María Soto', days: 6, date: '19 jun 2026', photo: false },
    { id: 1038, title: 'Cables eléctricos expuestos', desc: 'Tablero provisorio con conductores sin canalización en zona de tránsito de personal.', sev: 'high', status: 'open', location: 'Subterráneo -2', zone: 'Subterráneo -2', resp: 'Pedro Rojas', days: 1, date: '24 jun 2026', photo: true },
    { id: 1035, title: 'Falta señalética de evacuación', desc: 'Ruta de evacuación sin señalización fotoluminiscente en sector de oficinas piso 3.', sev: 'medium', status: 'open', location: 'Piso 3', zone: 'Oficinas P3', resp: 'Ana Díaz', days: 8, date: '17 jun 2026', photo: false },
    { id: 1030, title: 'EPP incompleto en cuadrilla de soldadura', desc: 'Dos soldadores sin careta fotosensible. Se realiza charla y reposición inmediata.', sev: 'medium', status: 'resolved', location: 'Taller', zone: 'Taller', resp: 'Luis Vega', days: 0, date: '12 jun 2026', photo: false },
    { id: 1024, title: 'Derrame de aceite en zona de tránsito', desc: 'Derrame controlado y limpiado. Se instala kit anti-derrame y demarcación.', sev: 'low', status: 'resolved', location: 'Patio de maniobras', zone: 'Patio maniobras', resp: 'Carla Núñez', days: 0, date: '08 jun 2026', photo: true },
  ];

  documents = [
    { type: 'Curso trabajo en altura', worker: 'María Soto', role: 'Prevencionista', date: '28 jun 2026', days: 3, status: 'expiring' },
    { type: 'Licencia conducir clase D', worker: 'Luis Vega', role: 'Operador grúa', date: '20 jun 2026', days: -4, status: 'expired' },
    { type: 'Examen altura física', worker: 'Juan Pérez', role: 'Maestro andamista', date: '12 jul 2026', days: 17, status: 'expiring' },
    { type: 'ODI firmada', worker: 'Carla Núñez', role: 'Bodeguera', date: '17 jul 2026', days: 22, status: 'expiring' },
    { type: 'Inducción hombre nuevo', worker: 'Pedro Rojas', role: 'Jornal', date: '04 dic 2026', days: 162, status: 'valid' },
    { type: 'Examen ocupacional', worker: 'Ana Díaz', role: 'Capataz', date: '21 nov 2026', days: 149, status: 'valid' },
  ];

  workers = [
    { name: 'Juan Pérez', role: 'Maestro andamista', rut: '15.482.331-9', docsOk: 4, docsTotal: 5, status: 'attention' },
    { name: 'María Soto', role: 'Prevencionista de riesgos', rut: '13.998.210-4', docsOk: 5, docsTotal: 5, status: 'ok' },
    { name: 'Pedro Rojas', role: 'Jornal', rut: '18.221.764-2', docsOk: 3, docsTotal: 4, status: 'attention' },
    { name: 'Luis Vega', role: 'Operador de grúa', rut: '12.554.901-7', docsOk: 2, docsTotal: 4, status: 'critical' },
    { name: 'Ana Díaz', role: 'Capataz', rut: '16.770.453-1', docsOk: 5, docsTotal: 5, status: 'ok' },
    { name: 'Carla Núñez', role: 'Bodeguera', rut: '19.003.882-5', docsOk: 4, docsTotal: 4, status: 'ok' },
  ];

  checklists = [
    { name: 'Inspección diaria de andamios', items: 24, last: 'Hoy, 08:30', score: 92, runs: 142 },
    { name: 'Checklist de EPP por cuadrilla', items: 12, last: 'Ayer, 17:10', score: 100, runs: 98 },
    { name: 'Revisión de equipos de izaje', items: 18, last: 'Hace 2 días', score: 78, runs: 56 },
    { name: 'Orden y aseo (5S)', items: 10, last: 'Hoy, 12:00', score: 85, runs: 120 },
  ];

  riskZonesData = [
    { name: 'Ala Norte · Piso 7', level: 'Alto', pct: 88, findings: 2, cause: 'Trabajo en altura' },
    { name: 'Subterráneo -2', level: 'Alto', pct: 80, findings: 1, cause: 'Riesgo eléctrico' },
    { name: 'Bodega 2', level: 'Medio', pct: 52, findings: 1, cause: 'Combustibles' },
    { name: 'Patio de maniobras', level: 'Medio', pct: 45, findings: 0, cause: 'Tránsito vehicular' },
    { name: 'Oficinas · Piso 3', level: 'Bajo', pct: 22, findings: 1, cause: 'Ergonomía' },
  ];

  // Edificios de la obra, cada uno con sus pisos. Cada piso trae las zonas que la IA detecta al escanear.
  buildings = [
    { id: 'A', name: 'Torre A', sub: 'Residencial · 7 niveles', floors: [
      { id: 'P7', label: 'Piso 7', area: '420 m²', zones: [
        { name: 'Fachada Norte', level: 'Alto', cause: 'Trabajo en altura', findings: 2, x: 150, y: 110 },
        { name: 'Perímetro Este', level: 'Medio', cause: 'Borde de losa', findings: 1, x: 470, y: 130 },
        { name: 'Núcleo central', level: 'Bajo', cause: 'Circulación', findings: 0, x: 300, y: 300 } ] },
      { id: 'P5', label: 'Piso 5', area: '420 m²', zones: [
        { name: 'Ducto de instalaciones', level: 'Medio', cause: 'Riesgo eléctrico', findings: 1, x: 200, y: 150 },
        { name: 'Terraza', level: 'Bajo', cause: 'Orden y aseo', findings: 0, x: 460, y: 320 } ] },
      { id: 'P3', label: 'Piso 3', area: '420 m²', zones: [
        { name: 'Oficinas', level: 'Bajo', cause: 'Ergonomía', findings: 1, x: 440, y: 150 } ] },
      { id: 'P1', label: 'Piso 1', area: '520 m²', zones: [
        { name: 'Acceso principal', level: 'Medio', cause: 'Tránsito de personal', findings: 1, x: 300, y: 110 },
        { name: 'Sala de máquinas', level: 'Alto', cause: 'Equipos energizados', findings: 1, x: 130, y: 320 } ] },
      { id: 'S1', label: 'Subterráneo -1', area: '600 m²', zones: [
        { name: 'Estacionamiento', level: 'Medio', cause: 'Monóxido / ventilación', findings: 0, x: 300, y: 220 } ] },
      { id: 'S2', label: 'Subterráneo -2', area: '600 m²', zones: [
        { name: 'Tablero general', level: 'Alto', cause: 'Riesgo eléctrico', findings: 1, x: 150, y: 300 },
        { name: 'Bodega de combustibles', level: 'Medio', cause: 'Inflamables', findings: 1, x: 470, y: 150 } ] },
    ] },
    { id: 'B', name: 'Torre B', sub: 'Oficinas · 5 niveles', floors: [
      { id: 'P5', label: 'Piso 5', area: '380 m²', zones: [
        { name: 'Coronación', level: 'Alto', cause: 'Trabajo en altura', findings: 1, x: 300, y: 110 } ] },
      { id: 'P3', label: 'Piso 3', area: '380 m²', zones: [
        { name: 'Shaft eléctrico', level: 'Medio', cause: 'Riesgo eléctrico', findings: 1, x: 180, y: 160 },
        { name: 'Hall', level: 'Bajo', cause: 'Circulación', findings: 0, x: 440, y: 300 } ] },
      { id: 'P1', label: 'Piso 1', area: '450 m²', zones: [
        { name: 'Recepción de materiales', level: 'Medio', cause: 'Carga y descarga', findings: 0, x: 300, y: 320 } ] },
    ] },
    { id: 'C', name: 'Estacionamientos', sub: 'Edificio anexo · 2 niveles', floors: [
      { id: 'N1', label: 'Nivel 1', area: '900 m²', zones: [
        { name: 'Rampa de acceso', level: 'Medio', cause: 'Tránsito vehicular', findings: 1, x: 200, y: 130 } ] },
      { id: 'N2', label: 'Nivel 2', area: '900 m²', zones: [
        { name: 'Zona técnica', level: 'Bajo', cause: 'Mantención', findings: 0, x: 460, y: 300 } ] },
    ] },
  ];

  fKey(b, f) { return b + '|' + f; }

  startScan() {
    if (this.state.scanning) return;
    const b = this.buildings[this.state.planBuilding];
    const key = this.fKey(b.id, this.state.planFloorId);
    const steps = ['Cargando plano del piso…', 'Detectando muros y recintos…', 'Identificando zonas de trabajo…', 'Clasificando niveles de riesgo…', 'Generando mapa de calor…'];
    this.setState({ scanning: true, scanProgress: 0, scanStep: steps[0] });
    let p = 0;
    clearInterval(this._scanTimer);
    this._scanTimer = setInterval(() => {
      p += 4 + Math.random() * 5;
      if (p >= 100) {
        p = 100;
        clearInterval(this._scanTimer);
        this.setState({ scanProgress: 100, scanStep: 'Análisis completado' });
        setTimeout(() => this.setState(st => ({ scanning: false, scanned: { ...st.scanned, [key]: true } })), 550);
        return;
      }
      const idx = Math.min(steps.length - 1, Math.floor(p / 20));
      this.setState({ scanProgress: Math.round(p), scanStep: steps[idx] });
    }, 130);
  }
  componentWillUnmount() { clearInterval(this._scanTimer); }

  reports = [
    { name: 'Informe semanal de seguridad', period: 'Semana 25 · 2026', date: 'Hoy', pages: 8, type: 'Semanal' },
    { name: 'Reporte mensual de hallazgos', period: 'Mayo 2026', date: '02 jun 2026', pages: 14, type: 'Mensual' },
    { name: 'Acta de inspección de andamios', period: '22 jun 2026', date: '22 jun 2026', pages: 4, type: 'Inspección' },
    { name: 'Informe de cumplimiento documental', period: 'Junio 2026', date: '15 jun 2026', pages: 6, type: 'Cumplimiento' },
  ];

  sevMap = {
    critical: { label: 'Crítico', color: '#d8443a', tint: '#fbe9e7' },
    high: { label: 'Alto', color: '#e8960b', tint: '#fbf0d9' },
    medium: { label: 'Medio', color: '#b8841a', tint: '#f7efdc' },
    low: { label: 'Bajo', color: '#6f6a60', tint: '#f0ece3' },
  };
  statusMap = {
    open: { label: 'Abierto', color: '#d8443a', tint: '#fbe9e7' },
    in_progress: { label: 'En proceso', color: '#e8960b', tint: '#fbf0d9' },
    resolved: { label: 'Resuelto', color: '#1f9d68', tint: '#e6f4ec' },
  };

  // ---- navigation helpers ----
  navStyle(active) {
    const base = 'display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;margin:1px 0;transition:background .14s,color .14s;';
    if (active) return base + 'color:#fff;background:rgba(247,245,240,.07);box-shadow:inset 3px 0 0 #f3a40a;';
    return base + 'color:rgba(246,244,238,.62);';
  }
  go(section) { this.setState({ section, aiOpen: false }); }

  // ---- AI reply generators (project-aware, demo) ----
  aiAnswer(q) {
    const t = (q || '').toLowerCase();
    const open = this.findings.filter(f => f.status !== 'resolved').length;
    if (/hallazg|riesg|crític|critic|andamio/.test(t)) return 'En ' + this.curProject.name + ' hay ' + open + ' hallazgos abiertos. El más urgente es el #1042 «Andamio sin barandas» (crítico), en Piso 7 · Ala Norte, responsable Juan Pérez, abierto hace 3 días. ¿Genero las acciones correctivas?';
    if (/document|vencim|venci|certific|licencia/.test(t)) return 'Hay 1 documento vencido (Licencia clase D de Luis Vega) y 4 por vencer en los próximos 30 días. ¿Quieres que prepare los recordatorios automáticos?';
    if (/personal|trabajador|gente|cuadrilla|persona/.test(t)) return 'Hay 48 personas en la obra. 2 trabajadores requieren atención documental y 1 está en estado crítico (Luis Vega, con 2 de 4 documentos al día).';
    if (/plano|zona|mapa/.test(t)) return 'Las zonas de mayor exposición son Ala Norte · Piso 7 (alto, trabajo en altura) y Subterráneo -2 (alto, riesgo eléctrico). Puedes verlas geolocalizadas en Planos · Riesgos.';
    if (/informe|reporte|pdf|acta/.test(t)) return 'Puedo generar el informe semanal de seguridad con los hallazgos críticos y el plan de acción, listo para exportar en PDF. ¿Lo creo ahora?';
    if (/cumplimiento|indice|índice|porcentaje|accidente|d[ií]as/.test(t)) return 'El índice de cumplimiento actual es 87 % (+4 % vs la semana pasada) y la obra acumula 142 días sin accidentes (récord histórico: 168).';
    if (/checklist|inspec|verifica/.test(t)) return 'Tienes 4 plantillas de checklist activas. La «Revisión de equipos de izaje» está en 78 % de cumplimiento — la más baja. ¿Quieres aplicarla hoy?';
    if (/hola|buenas|buenos|ayuda|qué puedes|que puedes|puedes hacer/.test(t)) return 'Puedo ayudarte con hallazgos, documentos y vencimientos, personal, planos de riesgo, informes y cumplimiento de ' + this.curProject.name + '. Pregúntame lo que necesites.';
    return 'Según los datos de ' + this.curProject.name + ', te recomiendo priorizar el hallazgo crítico #1042 y renovar la licencia vencida de Luis Vega. ¿Quieres el detalle de alguno de los dos?';
  }
  docAiAnswer(q) {
    const t = (q || '').toLowerCase();
    const patch = {}; const did = [];
    if (/altura/.test(t) && /curso/.test(t)) { patch.type = 'Curso trabajo en altura'; }
    else if (/licencia/.test(t)) { patch.type = 'Licencia conducir clase D'; }
    else if (/odi/.test(t)) { patch.type = 'ODI firmada'; }
    else if (/inducci/.test(t)) { patch.type = 'Inducción hombre nuevo'; }
    else if (/epp/.test(t)) { patch.type = 'Certificado de EPP'; }
    else if (/examen.*altura|altura.*examen/.test(t)) { patch.type = 'Examen altura física'; }
    else if (/ocupacional|examen/.test(t)) { patch.type = 'Examen ocupacional'; }
    if (patch.type) did.push('tipo «' + patch.type + '»');
    this.workers.forEach(w => { const fn = w.name.split(' ')[0].toLowerCase(); if (new RegExp('\\b' + fn + '\\b').test(t)) patch.worker = w.name; });
    if (patch.worker) did.push('trabajador ' + patch.worker);
    if (/dos a[nñ]os|2 a[nñ]os/.test(t)) { patch.validity = '24 meses'; }
    else if (/un a[nñ]o|1 a[nñ]o|anual/.test(t)) { patch.validity = '12 meses'; }
    else if (/seis meses|6 meses/.test(t)) { patch.validity = '6 meses'; }
    else if (/tres meses|3 meses/.test(t)) { patch.validity = '3 meses'; }
    if (patch.validity) did.push('vigencia ' + patch.validity);
    let reply;
    if (did.length) reply = 'Listo, actualicé ' + did.join(', ') + ' en el formulario. ¿Algo más que quieras ajustar?';
    else reply = 'Puedo completar el tipo de documento, el trabajador asignado y la vigencia. Por ejemplo: «certificado de EPP de Pedro Rojas, vigencia 6 meses». También puedes editar los campos a mano.';
    return { reply, patch };
  }
  _sendDocChat() {
    const q = (this.state.docChatInput || '').trim(); if (!q) return;
    const { reply, patch } = this.docAiAnswer(q);
    this.setState(st => ({ docChatInput: '', docDraft: { ...st.docDraft, ...patch }, docChat: [...st.docChat, { role: 'user', text: q }, { role: 'ai', text: reply }] }));
  }
  switchStyle(on) { return 'width:42px;height:24px;border-radius:13px;border:none;cursor:pointer;position:relative;flex-shrink:0;transition:background .16s;background:' + (on ? '#16130e' : '#d9d4c9') + ';'; }
  knobStyle(on) { return 'position:absolute;top:3px;left:' + (on ? '21px' : '3px') + ';width:18px;height:18px;border-radius:50%;background:#fff;transition:left .16s;box-shadow:0 1px 2px rgba(0,0,0,.2);'; }

  get curProject() { return this.projects.find(p => p.id === this.state.projectId) || this.projects[0]; }

  greeting() { const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; }

  // ---- charts ----
  findingsChart() {
    const data = [
      { w: 'S18', c: 5, r: 3 }, { w: 'S19', c: 4, r: 4 }, { w: 'S20', c: 7, r: 5 }, { w: 'S21', c: 3, r: 6 },
      { w: 'S22', c: 6, r: 4 }, { w: 'S23', c: 5, r: 7 }, { w: 'S24', c: 4, r: 5 }, { w: 'S25', c: 4, r: 3 },
    ];
    const max = 8, H = 150, barW = 13, gap = 8, groupGap = 22;
    const groupW = barW * 2 + gap;
    const W = data.length * (groupW + groupGap);
    const el = React.createElement;
    const bars = [];
    data.forEach((d, i) => {
      const gx = i * (groupW + groupGap) + 10;
      const ch = (d.c / max) * H, rh = (d.r / max) * H;
      bars.push(el('rect', { key: 'c' + i, x: gx, y: H - ch, width: barW, height: ch, rx: 3, fill: '#16130e' }));
      bars.push(el('rect', { key: 'r' + i, x: gx + barW + gap, y: H - rh, width: barW, height: rh, rx: 3, fill: '#f3a40a' }));
      bars.push(el('text', { key: 't' + i, x: gx + groupW / 2, y: H + 18, textAnchor: 'middle', fontSize: 11, fill: '#a59f93', fontFamily: 'IBM Plex Mono, monospace' }, d.w));
    });
    const grid = [0, 0.25, 0.5, 0.75, 1].map((g, i) => el('line', { key: 'g' + i, x1: 0, x2: W, y1: H - g * H, y2: H - g * H, stroke: '#f0ece3', strokeWidth: 1 }));
    return el('svg', { viewBox: `0 0 ${W} ${H + 26}`, width: '100%', style: { display: 'block' } }, [...grid, ...bars]);
  }

  // ---- handlers map for projects ----
  renderVals() {
    const s = this.state;
    const sev = this.sevMap, st = this.statusMap;
    const projects = this.projects.map(p => ({
      ...p,
      progressW: p.progress + '%',
      statusColor: p.status === 'closing' ? '#1f9d68' : '#f3a40a',
      findingsColor: p.openFindings > 2 ? '#d8443a' : '#f3a40a',
      onOpen: () => this.setState({ screen: 'app', section: 'dashboard', projectId: p.id }),
    }));

    const riskZones = this.riskZonesData.map(z => ({
      name: z.name, label: z.level, width: z.pct + '%',
      color: z.level === 'Alto' ? '#d8443a' : z.level === 'Medio' ? '#e8960b' : '#1f9d68',
    }));

    const expiringList = this.documents.filter(d => d.status !== 'valid').slice(0, 4).map(d => ({
      type: d.type, worker: d.worker,
      color: d.status === 'expired' ? '#d8443a' : '#e8960b',
      tint: d.status === 'expired' ? '#fbe9e7' : '#fbf0d9',
      badge: d.days < 0 ? 'Vencido' : d.days === 0 ? 'Hoy' : d.days + ' días',
    }));

    const recentFindings = this.findings.slice(0, 4).map(f => ({
      title: f.title, meta: '#' + f.id + ' · ' + f.location + ' · ' + f.resp,
      sev: sev[f.sev].label, color: sev[f.sev].color, tint: sev[f.sev].tint,
    }));

    const sectionTitles = { dashboard: 'Principal', hallazgos: 'Hallazgos', ia: 'Asistente IA', documentos: 'Documentos', doceditor: 'Editar documento', informes: 'Informes', personal: 'Personal', planos: 'Planos y mapa de riesgos', checklists: 'Checklists', config: 'Configuración' };

    return {
      isLogin: s.screen === 'login',
      isProjects: s.screen === 'projects',
      isApp: s.screen === 'app',
      isDashboard: s.section === 'dashboard',
      isHallazgos: s.section === 'hallazgos',
      isIA: s.section === 'ia',
      isDocumentos: s.section === 'documentos',
      isDocEditor: s.section === 'doceditor',
      isInformes: s.section === 'informes',
      isPersonal: s.section === 'personal',
      isPlanos: s.section === 'planos',
      isChecklists: s.section === 'checklists',
      isConfig: s.section === 'config',
      nav: s.nav,
      showNewProject: s.showNewProject,
      aiOpen: s.aiOpen,
      projects,
      projName: this.curProject.name,
      projCode: this.curProject.code,
      sectionTitle: sectionTitles[s.section] || 'Principal',
      greeting: this.greeting(),
      riskZones, expiringList, recentFindings,
      findingsChart: this.findingsChart(),
      // ---- Hallazgos ----
      findingFilter: s.findingFilter,
      fAll: s.findingFilter === 'todos', fOpen: s.findingFilter === 'open', fProg: s.findingFilter === 'in_progress', fRes: s.findingFilter === 'resolved',
      setFAll: () => this.setState({ findingFilter: 'todos' }),
      setFOpen: () => this.setState({ findingFilter: 'open' }),
      setFProg: () => this.setState({ findingFilter: 'in_progress' }),
      setFRes: () => this.setState({ findingFilter: 'resolved' }),
      fStatTotal: this.findings.length,
      fStatOpen: this.findings.filter(f => f.status === 'open').length,
      fStatProg: this.findings.filter(f => f.status === 'in_progress').length,
      fStatRes: this.findings.filter(f => f.status === 'resolved').length,
      findingsList: this.findings.filter(f => s.findingFilter === 'todos' ? true : f.status === s.findingFilter).map(f => ({
        id: '#' + f.id, title: f.title, desc: f.desc, location: f.location, resp: f.resp, date: f.date, days: f.days, photo: f.photo,
        sevLabel: sev[f.sev].label, sevColor: sev[f.sev].color, sevTint: sev[f.sev].tint,
        stLabel: st[f.status].label, stColor: st[f.status].color, stTint: st[f.status].tint,
        showDays: f.status !== 'resolved' && f.days > 0, daysTxt: 'Abierto hace ' + f.days + ' días',
      })),
      // ---- Documentos ----
      docsValid: this.documents.filter(d => d.status === 'valid').length,
      docsExpiring: this.documents.filter(d => d.status === 'expiring').length,
      docsExpired: this.documents.filter(d => d.status === 'expired').length,
      docsList: this.documents.map(d => {
        const c = d.status === 'expired' ? '#d8443a' : d.status === 'expiring' ? '#e8960b' : '#1f9d68';
        const t = d.status === 'expired' ? '#fbe9e7' : d.status === 'expiring' ? '#fbf0d9' : '#e6f4ec';
        const l = d.status === 'expired' ? 'Vencido' : d.status === 'expiring' ? 'Por vencer' : 'Vigente';
        return { type: d.type, worker: d.worker, role: d.role, date: d.date, color: c, tint: t, statusLabel: l,
          badge: d.days < 0 ? Math.abs(d.days) + ' días vencido' : d.days === 0 ? 'Vence hoy' : 'Vence en ' + d.days + ' días',
          initials: d.worker.split(' ').map(w => w[0]).join('').slice(0, 2) };
      }),
      // ---- Documentos: bandeja desde la app móvil ----
      mobilePendingCount: s.mobileUploads.filter(u => !u.classified).length,
      workerOptions: this.workers.map(w => w.name),
      docTypeOptions: this.docTypeOptions,
      mobileUploads: s.mobileUploads.map(u => ({
        id: u.id, file: u.file, time: u.time, zone: u.zone, uploadedBy: u.uploadedBy,
        isPhoto: u.kind === 'photo', isPdf: u.kind === 'pdf', classified: u.classified, pending: !u.classified,
        type: u.type, assignee: u.assignee,
        canConfirm: !!u.type && !!u.assignee,
        confirmStyle: 'height:36px;padding:0 14px;border:none;border-radius:9px;font-size:13px;font-weight:600;font-family:inherit;display:flex;align-items:center;gap:7px;flex-shrink:0;cursor:' + (u.type && u.assignee ? 'pointer' : 'not-allowed') + ';background:' + (u.type && u.assignee ? '#16130e' : '#e7e2d7') + ';color:' + (u.type && u.assignee ? '#f3a40a' : '#a59f93') + ';',
        initials: u.uploadedBy.split(' ').map(x => x[0]).join('').slice(0, 2),
        setType: (e) => { const v = e.target.value; this.setState({ mobileUploads: s.mobileUploads.map(x => x.id === u.id ? { ...x, type: v } : x) }); },
        setAssignee: (e) => { const v = e.target.value; this.setState({ mobileUploads: s.mobileUploads.map(x => x.id === u.id ? { ...x, assignee: v } : x) }); },
        confirm: () => { if (u.type && u.assignee) this.setState({ mobileUploads: s.mobileUploads.map(x => x.id === u.id ? { ...x, classified: true } : x) }); },
        reopen: () => this.setState({ mobileUploads: s.mobileUploads.map(x => x.id === u.id ? { ...x, classified: false } : x) }),
      })),
      // ---- Personal ----
      workersList: this.workers.map(w => {
        const c = w.status === 'critical' ? '#d8443a' : w.status === 'attention' ? '#e8960b' : '#1f9d68';
        const t = w.status === 'critical' ? '#fbe9e7' : w.status === 'attention' ? '#fbf0d9' : '#e6f4ec';
        const l = w.status === 'critical' ? 'Documentación crítica' : w.status === 'attention' ? 'Requiere atención' : 'Al día';
        return { name: w.name, role: w.role, rut: w.rut, docs: w.docsOk + '/' + w.docsTotal, width: Math.round(w.docsOk / w.docsTotal * 100) + '%',
          color: c, tint: t, statusLabel: l, initials: w.name.split(' ').map(x => x[0]).join('').slice(0, 2) };
      }),
      workersOk: this.workers.filter(w => w.status === 'ok').length,
      workersTotal: this.workers.length,
      // ---- Checklists ----
      checklistsList: this.checklists.map(c => ({ name: c.name, items: c.items + ' ítems', last: c.last, runs: c.runs + ' aplicaciones',
        score: c.score + '%', scoreW: c.score + '%', color: c.score >= 90 ? '#1f9d68' : c.score >= 80 ? '#e8960b' : '#d8443a' })),
      // ---- Planos · edificios / pisos / escáner IA ----
      planBuildings: this.buildings.map((b, i) => ({
        id: b.id, name: b.name, sub: b.sub, sel: i === s.planBuilding,
        tabStyle: 'display:flex;flex-direction:column;gap:2px;text-align:left;padding:11px 16px;border-radius:12px;border:1px solid ' + (i === s.planBuilding ? '#16130e' : '#e7e2d7') + ';background:' + (i === s.planBuilding ? '#16130e' : '#fff') + ';color:' + (i === s.planBuilding ? '#f6f4ee' : '#26221c') + ';cursor:pointer;font-family:inherit;min-width:150px;',
        subStyle: 'font-size:12px;color:' + (i === s.planBuilding ? 'rgba(246,244,238,.55)' : '#a59f93') + ';',
        onSel: () => { const nf = this.buildings[i].floors[0].id; this.setState({ planBuilding: i, planFloorId: nf, scanning: false }); },
      })),
      planFloors: (() => {
        const b = this.buildings[s.planBuilding];
        return b.floors.map(f => {
          const done = !!s.scanned[this.fKey(b.id, f.id)];
          const sel = f.id === s.planFloorId;
          return { id: f.id, label: f.label, area: f.area, scanned: done, sel,
            zonesCount: done ? f.zones.length + ' zonas · ' + f.zones.reduce((a, z) => a + z.findings, 0) + ' hallazgos' : 'Sin escanear',
            rowStyle: 'display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1.5px solid ' + (sel ? '#f3a40a' : '#e7e2d7') + ';background:' + (sel ? '#fffdf7' : '#fff') + ';cursor:pointer;',
            badgeStyle: 'width:9px;height:9px;border-radius:50%;flex-shrink:0;background:' + (done ? '#1f9d68' : '#d9d4c9') + ';',
            statusStyle: 'font-size:12px;color:' + (done ? '#8a8378' : '#b8841a') + ';',
            onSel: () => this.setState({ planFloorId: f.id, scanning: false }),
          };
        });
      })(),
      scannedCount: (() => { const b = this.buildings[s.planBuilding]; return b.floors.filter(f => s.scanned[this.fKey(b.id, f.id)]).length; })(),
      totalFloors: this.buildings[s.planBuilding].floors.length,
      curFloorLabel: (() => { const b = this.buildings[s.planBuilding]; const f = b.floors.find(x => x.id === s.planFloorId) || b.floors[0]; return b.name + ' · ' + f.label; })(),
      curFloorArea: (() => { const b = this.buildings[s.planBuilding]; const f = b.floors.find(x => x.id === s.planFloorId) || b.floors[0]; return f.area; })(),
      curFloorScanned: (() => { const b = this.buildings[s.planBuilding]; return !!s.scanned[this.fKey(b.id, s.planFloorId)]; })(),
      planNotScanned: (() => { const b = this.buildings[s.planBuilding]; return !s.scanning && !s.scanned[this.fKey(b.id, s.planFloorId)]; })(),
      scanning: s.scanning,
      scanProgress: s.scanProgress,
      scanProgressW: s.scanProgress + '%',
      scanStep: s.scanStep,
      startScan: () => this.startScan(),
      planPins: (() => {
        const b = this.buildings[s.planBuilding];
        const f = b.floors.find(x => x.id === s.planFloorId) || b.floors[0];
        if (!s.scanned[this.fKey(b.id, f.id)]) return [];
        const el = React.createElement;
        return f.zones.map((z, i) => {
          const col = z.level === 'Alto' ? '#d8443a' : z.level === 'Medio' ? '#e8960b' : '#1f9d68';
          const kids = [];
          if (z.level !== 'Bajo') kids.push(el('circle', { key: 'h', cx: z.x, cy: z.y, r: z.level === 'Alto' ? 26 : 22, fill: z.level === 'Alto' ? 'rgba(216,68,58,.25)' : 'rgba(232,150,11,.22)' },
            el('animate', { attributeName: 'r', values: (z.level === 'Alto' ? '20;30;20' : '16;26;16'), dur: '2.6s', repeatCount: 'indefinite' })));
          kids.push(el('circle', { key: 'p', cx: z.x, cy: z.y, r: 13, fill: col }));
          kids.push(el('text', { key: 't', x: z.x, y: z.y + 5, textAnchor: 'middle', fontSize: 13, fontWeight: 700, fill: '#fff', fontFamily: 'Space Grotesk' }, String(z.findings)));
          return el('g', { key: i }, kids);
        });
      })(),
      planZones: (() => {
        const b = this.buildings[s.planBuilding];
        const f = b.floors.find(x => x.id === s.planFloorId) || b.floors[0];
        if (!s.scanned[this.fKey(b.id, f.id)]) return [];
        return f.zones.map(z => ({ name: z.name, level: z.level, cause: z.cause, findings: z.findings + ' hallazgos',
          color: z.level === 'Alto' ? '#d8443a' : z.level === 'Medio' ? '#e8960b' : '#1f9d68',
          tint: z.level === 'Alto' ? '#fbe9e7' : z.level === 'Medio' ? '#fbf0d9' : '#e6f4ec' }));
      })(),
      // ---- Informes ----
      reportsList: this.reports.map(r => ({ name: r.name, period: r.period, date: r.date, pages: r.pages + ' páginas', type: r.type })),
      // ---- Config ----
      cfgGeneral: s.configTab === 'general', cfgNav: s.configTab === 'nav', cfgFirma: s.configTab === 'firma', cfgNotif: s.configTab === 'notif',
      setCfgGeneral: () => this.setState({ configTab: 'general' }),
      setCfgNav: () => this.setState({ configTab: 'nav' }),
      setCfgFirma: () => this.setState({ configTab: 'firma' }),
      setCfgNotif: () => this.setState({ configTab: 'notif' }),
      navToggles: [
        { key: 'hallazgos', label: 'Hallazgos', desc: 'Reporte y seguimiento de hallazgos de seguridad' },
        { key: 'documentos', label: 'Documentos', desc: 'Control documental y vencimientos' },
        { key: 'informes', label: 'Informes', desc: 'Generación de reportes y actas' },
        { key: 'personal', label: 'Personal', desc: 'Gestión de trabajadores de la obra' },
        { key: 'planos', label: 'Planos · Riesgos', desc: 'Mapa de riesgos sobre planos' },
        { key: 'checklists', label: 'Checklists', desc: 'Inspecciones y listas de verificación' },
      ].map(t => ({ ...t, on: !!s.nav[t.key], style: this.switchStyle(!!s.nav[t.key]), knob: this.knobStyle(!!s.nav[t.key]), onToggle: () => this.setState({ nav: { ...s.nav, [t.key]: !s.nav[t.key] } }) })),
      sigOn: s.sigEnabled, sigStyle: this.switchStyle(s.sigEnabled), sigKnob: this.knobStyle(s.sigEnabled),
      toggleSig: () => this.setState({ sigEnabled: !s.sigEnabled }),
      hasOpenFindings: true,
      openFindingsCount: this.findings.filter(f => f.status !== 'resolved').length,
      // ---- IA chat page ----
      iaInput: s.iaInput,
      iaMessages: s.iaMessages.map(m => ({
        text: m.text, isAi: m.role === 'ai',
        rowStyle: 'display:flex;' + (m.role === 'ai' ? 'justify-content:flex-start;' : 'justify-content:flex-end;'),
        bubbleStyle: m.role === 'ai'
          ? 'background:#16130e;color:#f6f4ee;border-radius:15px 15px 15px 5px;padding:13px 16px;font-size:14px;line-height:1.55;max-width:78%;'
          : 'background:#fff;border:1px solid #e7e2d7;color:#26221c;border-radius:15px 15px 5px 15px;padding:13px 16px;font-size:14px;line-height:1.55;max-width:78%;',
      })),
      setIaInput: (e) => this.setState({ iaInput: e.target.value }),
      iaKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); const q = (this.state.iaInput || '').trim(); if (!q) return; this.setState(st => ({ iaInput: '', iaMessages: [...st.iaMessages, { role: 'user', text: q }, { role: 'ai', text: this.aiAnswer(q) }] })); } },
      sendIa: () => { const q = (this.state.iaInput || '').trim(); if (!q) return; this.setState(st => ({ iaInput: '', iaMessages: [...st.iaMessages, { role: 'user', text: q }, { role: 'ai', text: this.aiAnswer(q) }] })); },
      askIa: (e) => { const q = e && e.currentTarget ? e.currentTarget.getAttribute('data-q') : ''; if (!q) return; this.setState(st => ({ iaMessages: [...st.iaMessages, { role: 'user', text: q }, { role: 'ai', text: this.aiAnswer(q) }] })); },
      // ---- Document editor ----
      docEditTitle: s.docEditTitle,
      docType: s.docDraft.type, docWorker: s.docDraft.worker, docIssue: s.docDraft.issueDate, docValidity: s.docDraft.validity, docNotes: s.docDraft.notes,
      setDocType: (e) => this.setState({ docDraft: { ...this.state.docDraft, type: e.target.value } }),
      setDocWorker: (e) => this.setState({ docDraft: { ...this.state.docDraft, worker: e.target.value } }),
      setDocIssue: (e) => this.setState({ docDraft: { ...this.state.docDraft, issueDate: e.target.value } }),
      setDocValidity: (e) => this.setState({ docDraft: { ...this.state.docDraft, validity: e.target.value } }),
      setDocNotes: (e) => this.setState({ docDraft: { ...this.state.docDraft, notes: e.target.value } }),
      docChatInput: s.docChatInput,
      docChat: s.docChat.map(m => ({
        text: m.text, isAi: m.role === 'ai',
        rowStyle: 'display:flex;' + (m.role === 'ai' ? 'justify-content:flex-start;' : 'justify-content:flex-end;'),
        bubbleStyle: m.role === 'ai'
          ? 'background:#16130e;color:#f6f4ee;border-radius:13px 13px 13px 4px;padding:11px 14px;font-size:13px;line-height:1.5;max-width:88%;'
          : 'background:#f0ece3;color:#26221c;border-radius:13px 13px 4px 13px;padding:11px 14px;font-size:13px;line-height:1.5;max-width:88%;',
      })),
      setDocChatInput: (e) => this.setState({ docChatInput: e.target.value }),
      docChatKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this._sendDocChat(); } },
      sendDocChat: () => this._sendDocChat(),
      validityOptions: ['3 meses', '6 meses', '12 meses', '24 meses'],
      workerOptionsAll: this.workers.map(w => w.name),
      docTypeOptionsAll: this.docTypeOptions,
      // nav styles
      navDashStyle: this.navStyle(s.section === 'dashboard'),
      navHallStyle: this.navStyle(s.section === 'hallazgos'),
      navIaStyle: this.navStyle(s.section === 'ia'),
      navDocsStyle: this.navStyle(s.section === 'documentos' || s.section === 'doceditor'),
      navRepStyle: this.navStyle(s.section === 'informes'),
      navPerStyle: this.navStyle(s.section === 'personal'),
      navPlaStyle: this.navStyle(s.section === 'planos'),
      navCheStyle: this.navStyle(s.section === 'checklists'),
      navCfgStyle: this.navStyle(s.section === 'config'),
      // handlers
      doLogin: () => this.setState({ screen: 'projects' }),
      doLogout: () => this.setState({ screen: 'login', aiOpen: false }),
      goProjects: () => this.setState({ screen: 'projects' }),
      openNewProject: () => this.setState({ showNewProject: true }),
      closeNewProject: () => this.setState({ showNewProject: false }),
      createProject: () => this.setState({ showNewProject: false }),
      stop: (e) => { if (e && e.stopPropagation) e.stopPropagation(); },
      toggleAI: () => this.setState({ aiOpen: !s.aiOpen }),
      goDash: () => this.go('dashboard'),
      goHallazgos: () => this.go('hallazgos'),
      goIA: () => this.go('ia'),
      goDocumentos: () => this.go('documentos'),
      openDocEditor: () => this.setState({ section: 'doceditor', aiOpen: false, docEditTitle: 'Nuevo documento', docDraft: { type: '', worker: '', issueDate: '', validity: '', notes: '' }, docChat: [{ role: 'ai', text: 'Estoy aquí para ayudarte a completar este documento. Dime de qué se trata y lo voy llenando — por ejemplo: «es un curso de trabajo en altura de María Soto, vigencia un año».' }] }),
      closeDocEditor: () => this.go('documentos'),
      saveDoc: () => this.go('documentos'),
      goInformes: () => this.go('informes'),
      goPersonal: () => this.go('personal'),
      goPlanos: () => this.go('planos'),
      goChecklists: () => this.go('checklists'),
      goConfig: () => this.go('config'),
    };
  }
}
