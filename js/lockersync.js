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

  // El texto de horario_atencion es libre (45+ formatos distintos, con horarios
  // diferentes por día que este sistema no modela). Tomamos el primer rango
  // horario que aparece como aproximación, y dejamos el texto completo en notas
  // para que se pueda revisar/corregir a mano si no calza.
  _parseHours(item) {
    if (item['24horas'] === '1') return { opens: null, closes: null, needsReview: false };
    const text = item.horario_atencion || '';
    const m = text.match(/(\d{1,2}):(\d{2})\s*(?:hs\.?)?\s*a\.?\s*(\d{1,2}):(\d{2})/i);
    if (!m) return { opens: null, closes: null, needsReview: true };
    const opens  = m[1].padStart(2, '0') + ':' + m[2];
    const closes = m[3].padStart(2, '0') + ':' + m[4];
    return { opens, closes, needsReview: true }; // siempre marcar para revisar — es una aproximación
  },

  async fetchList() {
    const url = this._endpointUrl();
    if (!url) throw new Error('Configurá primero la URL del motor en Configuración → Motor de rutas.');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
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
        opens: hours.opens, closes: hours.closes,
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
