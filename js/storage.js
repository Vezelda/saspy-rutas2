// storage.js — Gestión de persistencia en localStorage

const KEYS = {
  stops:    'saspy_stops',
  drivers:  'saspy_drivers',
  vehicles: 'saspy_vehicles',
  apiKey:   'saspy_ors_key',
  carriers: 'saspy_carriers',
  settings: 'saspy_settings',
};

const Storage = {

  // ── Inicialización ─────────────────────────────────────────────────────
  init() {
    const savedVer  = localStorage.getItem('saspy_data_version');
    const currentVer = typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '1';
    const needsLoad = !localStorage.getItem(KEYS.stops) || savedVer !== currentVer;

    if (needsLoad) {
      localStorage.setItem(KEYS.stops,    JSON.stringify(DATA_DEFAULT.stops));
      localStorage.setItem(KEYS.drivers,  JSON.stringify(DATA_DEFAULT.drivers));
      localStorage.setItem(KEYS.vehicles, JSON.stringify(DATA_DEFAULT.vehicles));
      localStorage.setItem('saspy_data_version', currentVer);
      if (!localStorage.getItem('saspy_carriers')) localStorage.setItem('saspy_carriers', '[]');
      if (savedVer && savedVer !== currentVer) {
        console.log('🔄 Nueva versión de datos (' + savedVer + ' → ' + currentVer + '). Paradas actualizadas automáticamente.');
      } else {
        console.log('✅ Datos iniciales cargados en localStorage (v' + currentVer + ')');
      }
    }
  },

  // ── Paradas ────────────────────────────────────────────────────────────
  getStops() {
    return JSON.parse(localStorage.getItem(KEYS.stops) || '[]');
  },
  saveStops(stops) {
    localStorage.setItem(KEYS.stops, JSON.stringify(stops));
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
    const stops = this.getStops().filter(s => s.id !== id);
    this.saveStops(stops);
  },

  // ── Choferes ───────────────────────────────────────────────────────────
  getDrivers() {
    return JSON.parse(localStorage.getItem(KEYS.drivers) || '[]');
  },
  saveDrivers(drivers) {
    localStorage.setItem(KEYS.drivers, JSON.stringify(drivers));
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
    const drivers = this.getDrivers().filter(d => d.id !== id);
    this.saveDrivers(drivers);
  },

  // ── Vehículos ──────────────────────────────────────────────────────────
  getVehicles() {
    return JSON.parse(localStorage.getItem(KEYS.vehicles) || '[]');
  },
  saveVehicles(vehicles) {
    localStorage.setItem(KEYS.vehicles, JSON.stringify(vehicles));
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
    const vehicles = this.getVehicles().filter(v => v.id !== id);
    this.saveVehicles(vehicles);
  },

  // ── API Key ────────────────────────────────────────────────────────────
  getApiKey() {
    return localStorage.getItem(KEYS.apiKey) || '';
  },
  setApiKey(key) {
    localStorage.setItem(KEYS.apiKey, key);
  },

  // ── Transportadoras ───────────────────────────────────────────────────
  getCarriers() {
    const raw = localStorage.getItem(KEYS.carriers);
    if (!raw) { localStorage.setItem(KEYS.carriers,'[]'); return []; }
    return JSON.parse(raw);
  },
  saveCarriers(carriers) { localStorage.setItem(KEYS.carriers, JSON.stringify(carriers)); },
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
  // Todo vive únicamente en localStorage — sin esto, limpiar el navegador
  // o cambiar de equipo borra paradas, choferes y vehículos sin aviso.
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
