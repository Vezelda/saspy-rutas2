// storage.js — Gestión de datos: localStorage siempre como base/respaldo local,
// y si hay un servidor de datos compartido configurado (Configuración → Motor de
// rutas — mismo servidor que VROOM), se sincroniza con él para que todos los que
// abren la app vean y editen lo mismo. Sin servidor configurado, funciona 100%
// local igual que antes (para uso de una sola persona/sin conexión).

const KEYS = {
  stops:    'saspy_stops',
  drivers:  'saspy_drivers',
  vehicles: 'saspy_vehicles',
  apiKey:   'saspy_ors_key',
  carriers: 'saspy_carriers',
  settings: 'saspy_settings',
  vroom:    'saspy_vroom_config',
  dailyHistory: 'saspy_daily_history',
  dailySession: 'saspy_daily',
};

// Claves que se sincronizan con el servidor compartido (todo excepto vroom —
// esa es la config de "a qué servidor hablarle", tiene que quedar local siempre).
const SYNCED = ['stops', 'drivers', 'vehicles', 'carriers', 'apiKey', 'settings', 'dailyHistory', 'dailySession'];

const Storage = {
  _cache: {},
  _ready: false,
  _syncing: false,

  // ── Motor de rutas / servidor compartido (100% local, nunca se sincroniza) ──
  getVroomConfig() {
    try { return JSON.parse(localStorage.getItem(KEYS.vroom) || 'null'); }
    catch(e) { return null; }
  },
  setVroomConfig(cfg) {
    localStorage.setItem(KEYS.vroom, JSON.stringify(cfg));
  },
  clearVroomConfig() {
    localStorage.removeItem(KEYS.vroom);
  },

  _apiBase() {
    const cfg = this.getVroomConfig();
    if (!cfg?.url) return null;
    return cfg.url.replace(/\/+$/, '') + '/api/data/';
  },
  _authHeaders() {
    const cfg = this.getVroomConfig();
    const h = { 'Content-Type': 'application/json' };
    if (cfg?.user) h['Authorization'] = 'Basic ' + btoa(cfg.user + ':' + (cfg.pass || ''));
    return h;
  },

  async _fetchKey(key) {
    const base = this._apiBase();
    if (!base) return undefined;
    try {
      const res = await fetch(base + key, { headers: this._authHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch(e) {
      console.warn('No se pudo traer "' + key + '" del servidor compartido:', e.message);
      return undefined;
    }
  },

  // Optimista: la memoria (y localStorage, de respaldo) se actualizan al toque;
  // el guardado en el servidor pasa en segundo plano. Si falla, el cambio queda
  // guardado en este navegador igual, con un aviso — no se pierde nada.
  _put(key, value) {
    this._cache[key] = value;
    localStorage.setItem(KEYS[key], JSON.stringify(value));
    const base = this._apiBase();
    if (!base) return;
    fetch(base + key, { method: 'PUT', headers: this._authHeaders(), body: JSON.stringify(value) })
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); })
      .catch(e => {
        console.warn('No se pudo guardar "' + key + '" en el servidor compartido:', e.message);
        if (typeof showToast === 'function') {
          showToast('⚠ No se pudo guardar "' + key + '" en el servidor compartido — el cambio quedó solo en este navegador.', 'error', 7000);
        }
      });
  },

  _getLocal(key, fallback) {
    try { return JSON.parse(localStorage.getItem(KEYS[key])) ?? fallback; }
    catch(e) { return fallback; }
  },

  // ── Inicialización ─────────────────────────────────────────────────────
  // Siempre arranca de localStorage (rápido, sincrónico, andá haya o no servidor).
  // Si hay servidor configurado, después pisa la memoria con lo que traiga de ahí
  // (async) — ver refreshFromServer(), que App.init() espera antes de renderizar.
  init() {
    const savedVer   = localStorage.getItem('saspy_data_version');
    const currentVer = typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '1';
    const needsSeed  = !localStorage.getItem(KEYS.stops) || savedVer !== currentVer;

    if (needsSeed) {
      localStorage.setItem(KEYS.stops,    JSON.stringify(DATA_DEFAULT.stops));
      localStorage.setItem(KEYS.drivers,  JSON.stringify(DATA_DEFAULT.drivers));
      localStorage.setItem(KEYS.vehicles, JSON.stringify(DATA_DEFAULT.vehicles));
      localStorage.setItem('saspy_data_version', currentVer);
      if (!localStorage.getItem(KEYS.carriers)) localStorage.setItem(KEYS.carriers, '[]');
    }

    SYNCED.forEach(key => { this._cache[key] = this._getLocal(key, key === 'dailySession' ? null : []); });
    // apiKey/dailySession no son arrays — corregir el default
    if (this._cache.apiKey === undefined || Array.isArray(this._cache.apiKey)) this._cache.apiKey = this._getLocal('apiKey', '') || '';
    this._ready = true;
  },

  // Trae lo último del servidor compartido (si hay uno configurado) y actualiza
  // la memoria + localStorage. Devuelve true si efectivamente sincronizó con un
  // servidor, false si está en modo 100% local.
  async refreshFromServer() {
    const base = this._apiBase();
    if (!base) return false;
    if (this._syncing) return true; // ya hay un refresh en curso, no lo dupliques
    this._syncing = true;
    try {
      const results = await Promise.all(SYNCED.map(k => this._fetchKey(k)));

      // Por cada clave: si el servidor tiene algo (no es null/vacío), eso manda.
      // Si el servidor todavía no tiene nada para esa clave (recién desplegado,
      // nadie la sembró todavía), NO pisamos lo que había local — lo dejamos
      // como estaba y lo subimos nosotros como semilla inicial.
      SYNCED.forEach((k, i) => {
        const serverVal = results[i];
        const serverEmpty = serverVal == null || (Array.isArray(serverVal) && serverVal.length === 0);
        if (serverEmpty) {
          const localVal = this._cache[k];
          const localHasData = Array.isArray(localVal) ? localVal.length > 0 : (localVal != null && localVal !== '');
          if (localHasData) this._put(k, localVal); // sembrar el servidor con lo que ya teníamos
          return;
        }
        this._cache[k] = serverVal;
        localStorage.setItem(KEYS[k], JSON.stringify(serverVal));
      });
      return true;
    } finally {
      this._syncing = false;
    }
  },

  // ── Paradas ────────────────────────────────────────────────────────────
  getStops() {
    return this._cache.stops || [];
  },
  saveStops(stops) {
    this._put('stops', stops);
  },
  updateStop(id, fields) {
    const stops = this.getStops();
    const idx = stops.findIndex(s => s.id === id);
    if (idx === -1) return false;
    stops[idx] = { ...stops[idx], ...fields };
    this.saveStops(stops);
    return true;
  },
  addStop(stop) {
    const stops = this.getStops();
    // Generar ID único
    const maxId = stops
      .filter(s => s.id.startsWith('L') || s.id.startsWith('S'))
      .map(s => parseInt(s.id.slice(1)) || 0)
      .reduce((a, b) => Math.max(a, b), 0);
    stop.id = `L${String(maxId + 1).padStart(3, '0')}`;
    stops.push(stop);
    this.saveStops(stops);
    return stop.id;
  },
  deleteStop(id) {
    this.saveStops(this.getStops().filter(s => s.id !== id));
  },

  // ── Choferes ───────────────────────────────────────────────────────────
  getDrivers() {
    return this._cache.drivers || [];
  },
  saveDrivers(drivers) {
    this._put('drivers', drivers);
  },
  updateDriver(id, fields) {
    const drivers = this.getDrivers();
    const idx = drivers.findIndex(d => d.id === id);
    if (idx === -1) return false;
    drivers[idx] = { ...drivers[idx], ...fields };
    this.saveDrivers(drivers);
    return true;
  },
  addDriver(driver) {
    const drivers = this.getDrivers();
    const maxId = drivers.map(d => parseInt(d.id.slice(1)) || 0).reduce((a,b) => Math.max(a,b), 0);
    driver.id = `D${String(maxId + 1).padStart(2, '0')}`;
    drivers.push(driver);
    this.saveDrivers(drivers);
    return driver.id;
  },
  deleteDriver(id) {
    this.saveDrivers(this.getDrivers().filter(d => d.id !== id));
  },

  // ── Vehículos ──────────────────────────────────────────────────────────
  getVehicles() {
    return this._cache.vehicles || [];
  },
  saveVehicles(vehicles) {
    this._put('vehicles', vehicles);
  },
  updateVehicle(id, fields) {
    const vehicles = this.getVehicles();
    const idx = vehicles.findIndex(v => v.id === id);
    if (idx === -1) return false;
    vehicles[idx] = { ...vehicles[idx], ...fields };
    this.saveVehicles(vehicles);
    return true;
  },
  addVehicle(vehicle) {
    const vehicles = this.getVehicles();
    const maxId = vehicles.map(v => parseInt(v.id.slice(1)) || 0).reduce((a,b) => Math.max(a,b), 0);
    vehicle.id = `V${String(maxId + 1).padStart(2, '0')}`;
    vehicles.push(vehicle);
    this.saveVehicles(vehicles);
    return vehicle.id;
  },
  deleteVehicle(id) {
    this.saveVehicles(this.getVehicles().filter(v => v.id !== id));
  },

  // ── API Key ────────────────────────────────────────────────────────────
  getApiKey() {
    return this._cache.apiKey || '';
  },
  setApiKey(key) {
    this._put('apiKey', key);
  },

  // ── Historial de rutas del día ─────────────────────────────────────────
  getDailyHistory() {
    return this._cache.dailyHistory || [];
  },
  // Guarda (o reemplaza, si ya existe una entrada para esa fecha) la sesión del día.
  archiveDailySession(session) {
    if (!session || !session.date) return;
    const history = this.getDailyHistory().filter(h => h.date !== session.date);
    history.push({ ...session, archivedAt: new Date().toISOString() });
    history.sort((a, b) => b.date.localeCompare(a.date));
    this._put('dailyHistory', history);
  },
  deleteDailyHistoryEntry(date) {
    this._put('dailyHistory', this.getDailyHistory().filter(h => h.date !== date));
  },

  // ── Sesión del día en curso ("Armar ruta del día") ─────────────────────
  // Compartida entre todos — si alguien la está armando, otra persona que entra
  // ve lo mismo y puede seguir donde quedó.
  getDailySession() {
    return this._cache.dailySession || null;
  },
  saveDailySession(session) {
    this._put('dailySession', session);
  },
  clearDailySession() {
    this._put('dailySession', null);
  },

  // ── Transportadoras ───────────────────────────────────────────────────
  getCarriers() {
    return this._cache.carriers || [];
  },
  saveCarriers(carriers) { this._put('carriers', carriers); },
  addCarrier(c) {
    const carriers = this.getCarriers();
    const maxId = carriers.map(x=>parseInt(x.id.slice(1))||0).reduce((a,b)=>Math.max(a,b),0);
    c.id = 'C' + String(maxId+1).padStart(2,'0');
    carriers.push(c); this.saveCarriers(carriers); return c.id;
  },
  updateCarrier(id, fields) {
    const carriers = this.getCarriers();
    const idx = carriers.findIndex(c=>c.id===id);
    if (idx===-1) return false;
    carriers[idx] = {...carriers[idx], ...fields};
    this.saveCarriers(carriers); return true;
  },
  deleteCarrier(id) {
    this.saveCarriers(this.getCarriers().filter(c=>c.id!==id));
  },

  // ── Reset (solo para desarrollo) ───────────────────────────────────────
  resetAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    this.init();
    console.log('🔄 Datos reiniciados a valores por defecto');
  },

  // ── Exportar / Importar (backup) ─────────────────────────────────────
  exportAll() {
    return {
      version:    typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '1',
      exportedAt: new Date().toISOString(),
      stops:      this.getStops(),
      drivers:    this.getDrivers(),
      vehicles:   this.getVehicles(),
      carriers:   this.getCarriers(),
    };
  },
  importAll(data) {
    if (!data || !Array.isArray(data.stops) || !Array.isArray(data.drivers) || !Array.isArray(data.vehicles)) {
      throw new Error('Archivo inválido: faltan paradas, choferes o vehículos.');
    }
    this.saveStops(data.stops);
    this.saveDrivers(data.drivers);
    this.saveVehicles(data.vehicles);
    if (Array.isArray(data.carriers)) this.saveCarriers(data.carriers);
  },
};
