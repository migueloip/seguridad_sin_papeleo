
class Component extends DCLogic {
  state = {
    screen: 'login',
    tab: 'home',
    anProgress: 0,
    anStep: '',
    sev: 'Alto',
    checkState: {}, // index -> 'ok'|'fail'|'na'
  };

  checkItemsData = [
    'Andamio con baranda perimetral y rodapié',
    'Plataforma de trabajo completa y sin huecos',
    'Arriostramiento y anclaje a estructura',
    'Acceso seguro (escalera fija o rampa)',
    'Tarjeta de inspección visible y vigente',
    'Superficie de apoyo nivelada y firme',
  ];

  go(screen) {
    const tabs = { home: 'home', checklists: 'checklists', checkrun: 'checklists', docs: 'docs', upload: 'docs', profile: 'profile' };
    this.setState({ screen, tab: tabs[screen] || this.state.tab });
  }

  startAnalyze() {
    const steps = ['Procesando imagen…', 'Detectando elementos de riesgo…', 'Clasificando severidad…', 'Sugiriendo acciones…'];
    this.setState({ screen: 'analyzing', anProgress: 0, anStep: steps[0] });
    let p = 0;
    clearInterval(this._t);
    this._t = setInterval(() => {
      p += 5 + Math.random() * 6;
      if (p >= 100) { p = 100; clearInterval(this._t); this.setState({ anProgress: 100, anStep: 'Listo' }); setTimeout(() => this.setState({ screen: 'result' }), 480); return; }
      this.setState({ anProgress: Math.round(p), anStep: steps[Math.min(steps.length - 1, Math.floor(p / 25))] });
    }, 140);
  }
  componentWillUnmount() { clearInterval(this._t); }

  greeting() { const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; }

  tabStyle(active) {
    return 'display:flex;flex-direction:column;align-items:center;gap:4px;border:none;background:transparent;cursor:pointer;font-family:inherit;padding:0 4px;width:58px;color:' + (active ? '#16130e' : '#b3ada1') + ';';
  }

  renderVals() {
    const s = this.state;
    const icon = (p) => React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' }, React.createElement('path', { d: p, stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }));

    const myReports = [
      { title: 'Cables eléctricos expuestos', meta: '#1038 · Hace 2 h', status: 'En revisión', color: '#e8960b', tint: '#fbf0d9' },
      { title: 'Falta señalética de evacuación', meta: '#1035 · Ayer', status: 'Abierto', color: '#d8443a', tint: '#fbe9e7' },
      { title: 'Derrame en zona de tránsito', meta: '#1024 · 08 jun', status: 'Resuelto', color: '#1f9d68', tint: '#e6f4ec' },
    ];

    const sevList = ['Crítico', 'Alto', 'Medio', 'Bajo'];
    const sevColor = { 'Crítico': '#d8443a', 'Alto': '#e8960b', 'Medio': '#b8841a', 'Bajo': '#6f6a60' };
    const sevChips = sevList.map(l => ({
      label: l, onSel: () => this.setState({ sev: l }),
      style: 'flex:1;height:42px;border-radius:11px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;border:1.5px solid ' + (s.sev === l ? sevColor[l] : '#e3ddd1') + ';background:' + (s.sev === l ? sevColor[l] : '#fff') + ';color:' + (s.sev === l ? '#fff' : '#6f6a60') + ';',
    }));

    const aiActions = [
      'Instalar baranda perimetral y rodapié en la plataforma',
      'Restringir el acceso a la zona hasta corregir',
      'Charla de 5 minutos a la cuadrilla de andamios',
    ];

    const mobileChecklists = [
      { name: 'Inspección diaria de andamios', meta: '6 ítems · Vence hoy 18:00', statusLabel: 'Pendiente', color: '#e8960b', tint: '#fbf0d9', progW: '0%', onOpen: () => this.go('checkrun') },
      { name: 'Checklist de EPP por cuadrilla', meta: '12 ítems · Completado 17:10', statusLabel: 'Hecho', color: '#1f9d68', tint: '#e6f4ec', progW: '100%', onOpen: () => this.go('checkrun') },
      { name: 'Orden y aseo (5S)', meta: '10 ítems · Vence hoy', statusLabel: 'En curso', color: '#b8841a', tint: '#f7efdc', progW: '40%', onOpen: () => this.go('checkrun') },
    ];

    const checkItems = this.checkItemsData.map((t, i) => {
      const st = s.checkState[i];
      const base = 'flex:1;height:40px;border-radius:10px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;border:1.5px solid ';
      return {
        text: t,
        setOk: () => this.setState({ checkState: { ...s.checkState, [i]: 'ok' } }),
        setFail: () => this.setState({ checkState: { ...s.checkState, [i]: 'fail' } }),
        setNa: () => this.setState({ checkState: { ...s.checkState, [i]: 'na' } }),
        okStyle: base + (st === 'ok' ? '#1f9d68;background:#1f9d68;color:#fff;' : '#e3ddd1;background:#fff;color:#1f9d68;'),
        failStyle: base + (st === 'fail' ? '#d8443a;background:#d8443a;color:#fff;' : '#e3ddd1;background:#fff;color:#d8443a;'),
        naStyle: base + (st === 'na' ? '#8a8378;background:#8a8378;color:#fff;' : '#e3ddd1;background:#fff;color:#8a8378;'),
      };
    });
    const checkDone = Object.keys(s.checkState).length;

    const myDocs = [
      { type: 'Inducción hombre nuevo', date: 'Vence 04 jul 2026', badge: '8 días', color: '#e8960b', tint: '#fbf0d9' },
      { type: 'Examen ocupacional', date: 'Vigente hasta nov 2026', badge: 'Vigente', color: '#1f9d68', tint: '#e6f4ec' },
      { type: 'ODI firmada', date: 'Vigente', badge: 'Vigente', color: '#1f9d68', tint: '#e6f4ec' },
      { type: 'Certificado de EPP', date: 'No registrado', badge: 'Falta', color: '#d8443a', tint: '#fbe9e7' },
    ];

    const profileItems = [
      { icon: icon('M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z'), label: 'Datos personales' },
      { icon: icon('M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z'), label: 'Notificaciones' },
      { icon: icon('M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z'), label: 'Mis hallazgos' },
      { icon: icon('M5 12h14M12 5v14'), label: 'Ayuda y soporte' },
    ];

    const showNav = ['home', 'checklists', 'docs', 'profile'].includes(s.screen);
    const dark = s.screen === 'login' || s.screen === 'report' || s.screen === 'analyzing';

    return {
      isLogin: s.screen === 'login',
      isHome: s.screen === 'home',
      isReport: s.screen === 'report',
      isAnalyzing: s.screen === 'analyzing',
      isResult: s.screen === 'result',
      isSent: s.screen === 'sent',
      isChecklists: s.screen === 'checklists',
      isCheckRun: s.screen === 'checkrun',
      isDocs: s.screen === 'docs',
      isUpload: s.screen === 'upload',
      isProfile: s.screen === 'profile',
      showNav,
      barBg: dark ? 'transparent' : '#f6f4ee',
      barColor: dark ? '#f6f4ee' : '#16130e',
      homeBarColor: dark ? 'rgba(246,244,238,.4)' : 'rgba(22,19,14,.25)',
      greeting: this.greeting(),
      myReports, sevChips, aiActions, mobileChecklists, checkItems, myDocs, profileItems,
      anProgress: s.anProgress, anProgressW: s.anProgress + '%', anStep: s.anStep,
      checkDoneCount: checkDone, checkTotal: this.checkItemsData.length, checkProgW: Math.round(checkDone / this.checkItemsData.length * 100) + '%',
      tabHomeStyle: this.tabStyle(s.tab === 'home'),
      tabCheckStyle: this.tabStyle(s.tab === 'checklists'),
      tabDocsStyle: this.tabStyle(s.tab === 'docs'),
      tabProfileStyle: this.tabStyle(s.tab === 'profile'),
      doLogin: () => this.go('home'),
      doLogout: () => this.setState({ screen: 'login', tab: 'home' }),
      goHome: () => this.go('home'),
      goReport: () => this.go('report'),
      startAnalyze: () => this.startAnalyze(),
      sendReport: () => this.setState({ screen: 'sent' }),
      goChecklists: () => this.go('checklists'),
      goDocs: () => this.go('docs'),
      goUpload: () => this.go('upload'),
      sendUpload: () => this.go('docs'),
      goProfile: () => this.go('profile'),
    };
  }
}
