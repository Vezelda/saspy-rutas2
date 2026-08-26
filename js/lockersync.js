// lockersync.js — Sincroniza lockers desde la API pública de Saspy Express
// Fuente: https://api.saspyexpress.com/lockers/listlockers/ (vía el proxy de la
// VM del motor de rutas, porque esa API no tiene CORS propio).

const LockerSync = {

  ENDPOINT: null, // se arma con la URL del motor guardada en Configuración → Motor de rutas

  _endpointUrl() {
    const cfg = Storage.getVroomConfig();
    if (!cfg?.url) return null;
    return cfg.url.replace(/\/+$/, '') + '/lockers-sync/';
  },

  // "lng,lat,elevacion" → {lat, lng}
  _parseCoords(raw) {
    const parts = (raw || '').split(',').map(parseFloat);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return { lat: null, lng: null };
    return { lng: parts[0], lat: parts[1] };
  },

  DAY_NAMES: ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'],

  _dayIndex(word) {
    if (!word) return null;
    // El grupo que captura el regex ya viene sin la "s" de plural (ese "s?" queda
    // afuera del grupo) — "lunes"/"martes"/"miercoles"/"jueves"/"viernes" terminan
    // en "s" de por sí (no son plurales), así que NO hay que sacarles nada más.
    const idx = this.DAY_NAMES.indexOf(word.toLowerCase());
    return idx === -1 ? null : idx;
  },

  // "lunes" → [1]. "sabado a domingo" → [6,0] (envuelve la semana). "martes a domingo" → [2,3,4,5,6,0].
  _expandDayRange(fromWord, toWord) {
    const from = this._dayIndex(fromWord);
    const to   = toWord ? this._dayIndex(toWord) : from;
    if (from === null || to === null) return [];
    const days = [];
    let d = from;
    for (let i = 0; i < 7; i++) {
      days.push(d);
      if (d === to) break;
      d = (d + 1) % 7;
    }
    return days;
  },

  // El texto de horario_atencion es libre (45+ formatos distintos vistos en la API,
  // con horarios diferentes por día — ej. "Lunes a Viernes 7 a 21 - Sábados 8 a 18").
  // Devuelve hoursByDay: {0..6: {opens,closes}} para los días que el texto menciona
  // explícitamente. Los días no mencionados quedan sin entrada — el optimizador cae
  // al horario general (opens/closes) para esos, en vez de asumir que está cerrado.
  _parseHoursByDay(text) {
    if (!text) return null;
    if (/24\s*\/?\s*7|24\s*hs/i.test(text)) return null; // ya cubierto por 24horas — sin restricción

    const norm = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const DAY = '(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?';
    const re = new RegExp(
      DAY + '(?:\\s*a\\s*' + DAY + ')?' +
      '\\s*(?:de\\s*)?(\\d{1,2})[:.](\\d{2})\\s*(?:hs\\.?)?\\.?\\s*(?:-|a)\\.?\\s*(\\d{1,2})[:.](\\d{2})\\s*(?:hs\\.?)?\\.?' +
      // turno partido opcional: "y de HH:MM a HH:MM" — se fusiona en un solo rango
      '(?:\\s*y\\s*(?:de\\s*)?(\\d{1,2})[:.](\\d{2})\\s*(?:hs\\.?)?\\.?\\s*a\\.?\\s*(\\d{1,2})[:.](\\d{2})\\s*(?:hs\\.?)?)?',
      'gi'
    );

    const byDay = {};
    let m, found = false;
    while ((m = re.exec(norm))) {
      const days = this._expandDayRange(m[1], m[2]);
      if (!days.length) continue;
      found = true;

      let openMin  = parseInt(m[3]) * 60 + parseInt(m[4]);
      let closeMin = parseInt(m[5]) * 60 + parseInt(m[6]);
      if (m[7] != null) { // turno partido — el rango completo cubre ambos tramos
        openMin  = Math.min(openMin,  parseInt(m[7]) * 60 + parseInt(m[8]));
        closeMin = Math.max(closeMin, parseInt(m[9]) * 60 + parseInt(m[10]));
      }
      const opens  = String(Math.floor(openMin / 60)).padStart(2, '0')  + ':' + String(openMin % 60).padStart(2, '0');
      const closes = String(Math.floor(closeMin / 60)).padStart(2, '0') + ':' + String(closeMin % 60).padStart(2, '0');
      days.forEach(d => { byDay[d] = { opens, closes }; });
    }
    return found ? byDay : null;
  },

  _parseHours(item) {
    if (item['24horas'] === '1') return { opens: null, closes: null, hoursByDay: null, needsReview: false };

    const text = item.horario_atencion || '';
    const hoursByDay = this._parseHoursByDay(text);

    // Horario "plano" de respaldo — usado como fallback para días no documentados,
    // y como valor mostrado en la columna simple de la tabla. Preferimos el de un
    // lunes común (representativo del horario de semana); si no hay, el primero que haya.
    let opens = null, closes = null;
    if (hoursByDay) {
      const rep = hoursByDay[1] || Object.values(hoursByDay)[0];
      opens = rep.opens; closes = rep.closes;
    } else {
      const m = text.match(/(\d{1,2})[:.](\d{2})\s*(?:hs\.?)?\.?\s*(?:-|a)\.?\s*(\d{1,2})[:.](\d{2})/i);
      if (m) { opens = m[1].padStart(2,'0')+':'+m[2]; closes = m[3].padStart(2,'0')+':'+m[4]; }
    }

    return { opens, closes, hoursByDay, needsReview: true }; // siempre revisar — es una aproximación del texto libre
  },

  async fetchList() {
    const url = this._endpointUrl();
    if (!url) throw new Error('Configurá primero la URL del motor en Configuración → Motor de rutas.');
    const cfg = Storage.getVroomConfig();
    const headers = { 'Content-Type': 'application/json' };
    if (cfg?.user) headers['Authorization'] = 'Basic ' + btoa(cfg.user + ':' + (cfg.pass || ''));
    const res = await fetch(url, { method: 'POST', headers });
    if (!res.ok) throw new Error('El servidor respondió ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data.list)) throw new Error('Respuesta inesperada de la API de lockers.');
    return data.list;
  },

  async sync() {
    const remote = await this.fetchList();
    const stops  = Storage.getStops();
    const byApiId = new Map(stops.filter(s => s.apiLockerId).map(s => [s.apiLockerId, s]));
    const byName  = new Map(stops.filter(s => !s.apiLockerId && s.type === 'LOCKER').map(s => [s.name.trim().toLowerCase(), s]));

    let added = 0, updated = 0, deactivated = 0, needsReview = 0;
    const seenApiIds = new Set();

    for (const item of remote) {
      const apiId = String(item.id);
      seenApiIds.add(apiId);

      const { lat, lng } = this._parseCoords(item.coords);
      const hours = this._parseHours(item);
      if (hours.needsReview) needsReview++;

      const name = item.locker_name || item.sucursal_name || ('Locker ' + apiId);
      const noteParts = [];
      if (item.asociado_nombre)    noteParts.push('Asociado: ' + item.asociado_nombre);
      if (item.locker_backup_name) noteParts.push('Backup: ' + item.locker_backup_name);
      if (item.horario_atencion)   noteParts.push('Horario (texto original): ' + item.horario_atencion);

      const fields = {
        name, type: 'LOCKER',
        address: item.direccion || '',
        city:    item.localidad || '',
        dept:    item.departamento || '',
        lat, lng,
        opens: hours.opens, closes: hours.closes, hoursByDay: hours.hoursByDay,
        mapsUrl: item.link_maps || '',
        notes: noteParts.join(' · '),
        apiLockerId: apiId,
        active: true,
      };

      const existing = byApiId.get(apiId) || byName.get(name.trim().toLowerCase());
      if (existing) {
        Storage.updateStop(existing.id, fields);
        updated++;
      } else {
        Storage.addStop({ ...fields, id: '' });
        added++;
      }
    }

    // Lockers que ya estaban sincronizados pero ya no vienen en la lista de la API
    // (se movieron o cerraron) — se desactivan, no se borran, para no perder historial.
    for (const s of stops) {
      if (s.apiLockerId && !seenApiIds.has(s.apiLockerId) && s.active !== false) {
        Storage.updateStop(s.id, { active: false });
        deactivated++;
      }
    }

    return { added, updated, deactivated, needsReview, total: remote.length };
  },
};
