// optimizer.js — ORS Matrix por chofer + solver local con corredores reales

const Optimizer = {

  MATRIX_URL: 'https://api.openrouteservice.org/v2/matrix/driving-car',

  // Corredores indexados por clave — NO por nombre de chofer.
  // El campo driver.corridor vincula al chofer con su corredor.
  // Compatibilidad: si driver.corridor no está, se infiere del nombre.
  CORRIDORS: {
    'norte': { depts: new Set(['Concepción','San Pedro','Amambay']),
               waypoints: [
                 { lat:-25.2796, lng:-57.4686 }, // CDD
                 { lat:-24.66,  lng:-56.44   }, // Santani
                 { lat:-22.54,  lng:-55.73   }, // Pedro Juan Caballero
               ]},
    // Solo Alto Paraná/Canindeyú (zona de Ciudad del Este) — Cordillera
    // (Caacupé) y Caaguazú (Cnel. Oviedo) NO son parte de este corredor,
    // se reparten como cualquier parada urbana más por cercanía geográfica.
    'este':  { depts: new Set(['Alto Paraná','Canindeyú']),
               waypoints: [
                 { lat:-25.2796, lng:-57.4686 }, // CDD
                 { lat:-25.52,  lng:-54.61   }, // Ciudad del Este
               ]},
    'sur':   { depts: new Set(['Paraguarí','Guairá','Itapúa','Misiones']),
               waypoints: [
                 { lat:-25.2796,lng:-57.4686 }, // CDD
                 { lat:-25.37,  lng:-57.50   }, // San Lorenzo
                 { lat:-25.63,  lng:-57.15   }, // Paraguarí
                 { lat:-25.78,  lng:-56.45   }, // Villarrica
                 { lat:-26.19,  lng:-56.44   }, // Caazapá
                 { lat:-26.68,  lng:-57.13   }, // San Juan Bautista
                 { lat:-26.88,  lng:-57.02   }, // San Ignacio
                 { lat:-26.96,  lng:-56.26   }, // Coronel Bogado
                 { lat:-27.33,  lng:-55.87   }, // Encarnación
               ]},
  },

  // Backward-compat: inferir corredor desde nombre del chofer
  _corridorKeyFromDriver(driver) {
    const c = driver?.corridor;
    if (c && this.CORRIDORS[c]) return c;
    const n = (driver?.name || '').toUpperCase();
    if (n.includes('HERNAN'))   return 'norte';
    if (n.includes('CARBALLO')) return 'este';
    if (n.includes('JOSE'))     return 'sur';
    return null;
  },

  // Caaguazú y Cordillera (Caacupé, Cnel. Oviedo) quedaron afuera a propósito:
  // se reparten como cualquier parada urbana más, no fuerzan chofer de corredor.
  INTERIOR_DEPTS: new Set([
    'Amambay','Alto Paraná','Canindeyú','Guairá','Itapúa',
    'Misiones','Paraguarí','San Pedro','Concepción',
    'Presidente Hayes','Neembucú','Pdte. Hayes',
  ]),

  // Velocidades para la matriz Haversine (fallback sin ORS).
  // La salida de Gran Asunción tarda mucho más que la autopista abierta.
  // "nearDepot" aplica a tramos donde al menos un extremo está < 30km del CDD.
  SPEED: {
    city:      22,   // km/h — calles de ciudad, siempre lento
    nearDepot: 22,   // km/h — tramos urbanos / suburbanos cerca del CDD
    highway:   65,   // km/h — autopistas interiores (PY02, PY01, PY09...)
  },

  // ── Tráfico estimado por franja horaria ─────────────────────────────────
  // NO es tráfico en vivo (eso requeriría un proveedor pago tipo Google/TomTom).
  // Es un supuesto fijo de cuánto más lento es viajar en cada franja del día,
  // ajustá los "factor" según lo que se observe realmente en la calle.
  // Se aplica tramo por tramo, según la hora real en que ocurre cada tramo
  // (no solo la hora de salida) — un tramo a las 13:30 sí lleva su recargo.
  TRAFFIC_BANDS: [
    { from: 6.0  * 3600, to: 7.0  * 3600, factor: 1.05 }, // temprano
    { from: 7.0  * 3600, to: 8.5  * 3600, factor: 1.30 }, // pico mañana
    { from: 8.5  * 3600, to: 11.5 * 3600, factor: 1.00 },
    { from: 11.5 * 3600, to: 13.5 * 3600, factor: 1.20 }, // almuerzo / centro
    { from: 13.5 * 3600, to: 17.0 * 3600, factor: 1.00 },
    { from: 17.0 * 3600, to: 19.5 * 3600, factor: 1.35 }, // pico tarde
    { from: 19.5 * 3600, to: 22.0 * 3600, factor: 1.05 },
  ],

  _trafficFactorAt(secs) {
    const t = secs % 86400; // por si la ruta cruza medianoche
    const band = this.TRAFFIC_BANDS.find(b => t >= b.from && t < b.to);
    return band ? band.factor : 1.0; // de noche / madrugada: sin recargo
  },

  // Recalcula tiempos de viaje y llegada tramo por tramo aplicando el factor de
  // tráfico vigente en el momento en que ESE tramo específico ocurre. El orden de
  // las paradas no cambia (eso ya lo decidió el solver) — solo se ajustan los horarios.
  // sMap: stopId -> parada, para poder seguir respetando horario de apertura acá
  // (si no, el recargo de tráfico pisaba la espera hasta que abre y la ignoraba).
  applyTrafficFactor(solution, depTime, sMap) {
    let time = depTime;
    return solution.map(s => {
      const factor      = this._trafficFactorAt(time);
      const adjTravel   = Math.round((s.travelTime || 0) * factor);
      const stop        = sMap ? sMap[s.stopId] : null;
      const arrival     = stop ? Math.max(time + adjTravel, this._opens(stop, depTime)) : time + adjTravel;
      time = arrival + (s.service || 0);
      return { ...s, travelTime: adjTravel, arrival };
    });
  },

  // Cuando el motor propio (VROOM) no puede encajar una parada en la ventana
  // de tiempo del chofer, en vez de descartarla en silencio la agrega igual
  // al final de su ruta — con una estimación aproximada en línea recta — y
  // la marca "late" para que se vea con aviso en la hoja de ruta. El chofer
  // decide si realmente la hace o no; la app nunca la borra del todo.
  _appendLateStops(solution, lateStops, startPoint, driverStopsMap, depTime, packages) {
    let time = solution.length
      ? solution[solution.length - 1].arrival + solution[solution.length - 1].service
      : depTime;
    let prevLoc = solution.length
      ? (driverStopsMap[solution[solution.length - 1].stopId] || startPoint)
      : startPoint;
    for (const stop of lateStops) {
      const distKm     = this.haversine(prevLoc, stop);
      const travelTime = Math.round(distKm / this.SPEED.city * 3600); // estimación conservadora
      const arrival    = time + travelTime;
      const service    = this._svc(stop, packages);
      solution.push({ stopId: stop.id, arrival, service, travelTime, late: true });
      time = arrival + service;
      prevLoc = stop;
    }
  },

  // ── Haversine (km) ─────────────────────────────────────────────────────
  haversine(a, b) {
    const R = 6371, r = Math.PI / 180;
    const dL = (b.lat-a.lat)*r, dG = (b.lng-a.lng)*r;
    const s  = Math.sin(dL/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dG/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
  },

  // ── Posición real (km) del stop sobre la polilínea del corredor ──
  // Encuentra el segmento más cercano al stop y devuelve la distancia acumulada
  // en km desde el inicio del corredor hasta el punto de proyección.
  corridorPosition(stop, corridor) {
    const wps = corridor.waypoints;
    let bestPos = 0;
    let bestPerpKm = Infinity;
    let cumKm = 0;

    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i+1];
      const segKm = this.haversine(a, b);
      const dx = b.lng - a.lng;
      const dy = b.lat - a.lat;
      const len2 = dx*dx + dy*dy;
      if (len2 === 0) { cumKm += segKm; continue; }

      // Parámetro t del punto proyectado (clamp 0..1 para quedar dentro del segmento)
      const t = Math.max(0, Math.min(1,
        ((stop.lng - a.lng) * dx + (stop.lat - a.lat) * dy) / len2));

      // Coordenadas del punto proyectado
      const projLng = a.lng + t * dx;
      const projLat = a.lat + t * dy;
      // Distancia perpendicular real (km) del stop al corredor
      const perpKm = this.haversine(stop, { lat: projLat, lng: projLng });

      // El stop se asigna al segmento más cercano geográficamente
      if (perpKm < bestPerpKm) {
        bestPerpKm = perpKm;
        bestPos = cumKm + t * segKm;
      }
      cumKm += segKm;
    }
    return bestPos;
  },

  // ── Obtener matriz ORS real (por chofer, max ~25+1=26 puntos = 676 celdas) ──
  async fetchMatrix(points, apiKey) {
    const locations = points.map(p => [p.lng, p.lat]);
    const res = await fetch(this.MATRIX_URL, {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations, metrics: ['duration','distance'] }),
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error?.message || 'Matrix API error ' + res.status);
    }
    const data = await res.json();
    return { durations: data.durations, distances: data.distances };
  },

  // ── Motor propio (VROOM auto-hospedado): resuelve orden + tiempos reales de una ──
  // Reemplaza fetchMatrix+solveLocal cuando hay un motor configurado en
  // Configuración → Motor de rutas. Sin ventanas para paradas 24hs (VROOM las
  // deja sin restricción en vez de forzar 00:00-24:00 como hacía el solver local).
  async solveWithVroom(depot, driverStops, depTime, packages, driver, endsAtHome, vroomCfg) {
    const jobs = driverStops.map((s, i) => {
      const job = { id: i + 1, location: [s.lng, s.lat], service: this._svc(s, packages) };
      if (s.opens || s.closes || s.hoursByDay) job.time_windows = [[this._opens(s, depTime), this._closes(s, depTime)]];
      return job;
    });

    const end = (endsAtHome && driver?.homeLat != null)
      ? [driver.homeLng, driver.homeLat]
      : [depot.lng, depot.lat];

    const body = {
      vehicles: [{
        id: 1,
        start: [depot.lng, depot.lat],
        end,
        time_window: [depTime, depTime + 21 * 3600], // margen amplio para rutas largas/nocturnas
      }],
      jobs,
    };

    const url = vroomCfg.url.replace(/\/+$/, '') + '/';
    const headers = { 'Content-Type': 'application/json' };
    if (vroomCfg.user) headers['Authorization'] = 'Basic ' + btoa(vroomCfg.user + ':' + (vroomCfg.pass || ''));

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('El motor respondió ' + res.status);
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.error || 'El motor no pudo resolver la ruta');

    // VROOM puede decidir que una parada NO entra en el día de este chofer (choca con
    // otra ventana horaria, o directamente no hay tiempo físico) y la manda a su propia
    // lista de "unassigned" en vez de forzarla — hay que rescatar esos ids, si no
    // desaparecen en silencio (ni en la ruta, ni en el aviso de "sin asignar").
    const vroomUnassigned = (data.unassigned || [])
      .map(u => driverStops[u.id - 1]?.id)
      .filter(Boolean);

    if (!data.routes || !data.routes.length) return { steps: [], distance: 0, unassigned: vroomUnassigned };

    const route    = data.routes[0];
    const rawSteps = route.steps || [];

    // VROOM elige libremente CUÁNDO salir del depósito dentro de su ventana — si el
    // primer horario es restrictivo, puede "atrasar la salida" en vez de salir a la
    // hora fija y esperar en destino. Eso no sirve: el chofer sale a la hora que
    // configuraste, no cuando le convenga al algoritmo. Por eso no usamos vs.arrival
    // directo — usamos el ORDEN y el tiempo de viaje real por tramo que ya calculó
    // (vs.duration es acumulado puro de viaje, no se corre si VROOM atrasa el inicio),
    // y repetimos el recorrido con nuestra hora de salida fija como ancla — mismo
    // criterio que usa el solver local (replayRoute) para que ambos caminos se
    // comporten igual.
    let time = depTime, prevDuration = 0;
    const steps = rawSteps.filter(s => s.type === 'job').map(vs => {
      const stop       = driverStops[vs.id - 1];
      const travelTime = Math.max(0, (vs.duration || 0) - prevDuration);
      prevDuration     = vs.duration || 0;
      const arrival    = Math.max(time + travelTime, this._opens(stop, depTime));
      const service    = vs.service || 0;
      time = arrival + service;
      return { stopId: stop.id, arrival, service, travelTime };
    });

    const totalDistance = rawSteps.length ? (rawSteps[rawSteps.length - 1].distance || 0) : 0;
    return { steps, distance: totalDistance, geometry: route.geometry || null, unassigned: vroomUnassigned };
  },

  // ── Matriz local Haversine (fallback sin API) ──────────────────────────
  buildLocalMatrix(points, isInterior) {
    const n     = points.length;
    const depot = points[0]; // depot siempre en índice 0
    const dur   = Array.from({length:n}, () => new Array(n).fill(0));
    const dst   = Array.from({length:n}, () => new Array(n).fill(0));

    for (let i=0; i<n; i++) for (let j=0; j<n; j++) {
      if (i===j) continue;
      const km = this.haversine(points[i], points[j]);
      dst[i][j] = km * 1000;

      let spd;
      if (!isInterior) {
        spd = this.SPEED.city;
      } else {
        // Si alguno de los dos extremos está a < 30km del CDD → zona urbana lenta.
        // Una vez en autopista (ambos > 30km del CDD) → velocidad de ruta.
        const dI = this.haversine(depot, points[i]);
        const dJ = this.haversine(depot, points[j]);
        spd = (Math.min(dI, dJ) < 30) ? this.SPEED.nearDepot : this.SPEED.highway;
      }
      dur[i][j] = (km / spd) * 3600;
    }
    return { durations: dur, distances: dst };
  },

  // ── Consolidar paradas muy cercanas (< 100m) ──────────────────────────
  consolidateNearby(stops, maxDistKm = 0.1) {
    // Usa componentes conectadas para agrupar paradas cercanas transitivamente
    // Ejemplo: si A-B están a 50m, B-C a 50m → A,B,C en el mismo grupo
    // maxDistKm = 0.1 → ~100m
    
    const n = stops.length;
    if (n === 0) return { groups: [], mapping: {} };
    
    // Construir grafo de adyacencia
    const adj = Array.from({length: n}, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dist = this.haversine(stops[i], stops[j]);
        if (dist <= maxDistKm) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }
    
    // DFS para encontrar componentes conectadas
    const visited = Array(n).fill(false);
    const groups = [];
    const mapping = {};
    
    const dfs = (idx, group) => {
      visited[idx] = true;
      group.push(stops[idx]);
      for (const next of adj[idx]) {
        if (!visited[next]) dfs(next, group);
      }
    };
    
    for (let i = 0; i < n; i++) {
      if (!visited[i]) {
        const group = [];
        dfs(i, group);
        const groupIdx = groups.length;
        groups.push(group);
        group.forEach(s => { mapping[s.id] = groupIdx; });
      }
    }
    
    return { groups, mapping };
  },

  // ── Auto-asignación por corredor ───────────────────────────────────────
  autoAssign(session) {
    const stops    = Storage.getStops();
    const drivers  = Storage.getDrivers();
    const carriers = Storage.getCarriers();
    const sMap     = Object.fromEntries(stops.map(s => [s.id, s]));
    const dMap     = Object.fromEntries(drivers.map(d => [d.id, d]));

    const activeDrivers = session.assignments.map(a => {
      const d = dMap[a.driverId];
      return { ...a, name: d?.name || '', corridorKey: this._corridorKeyFromDriver(d) };
    });

    const activeStops = Object.entries(session.packages)
      .filter(([, qty]) => qty > 0)
      .map(([id]) => sMap[id])
      .filter(s => s && s.lat !== null && s.type !== 'DEPOT');

    // Helper: find active driver with given corridor key
    const findByCorridorKey = (key) => activeDrivers.find(a => a.corridorKey === key);
    const corridorDrivers   = activeDrivers.filter(a => !!a.corridorKey);

    const result = {};
    const urbanLeftover = [];

    // ── Paso 1: paradas de interior → chofer del corredor por departamento ──
    for (const stop of activeStops) {
      let assigned = false;

      // Find which corridor covers this stop's department
      for (const [cKey, corridor] of Object.entries(this.CORRIDORS)) {
        if (!corridor.depts.has(stop.dept)) continue;

        // Is a driver with this corridor active today?
        const driver = findByCorridorKey(cKey);
        if (driver) {
          // TRANSPORTADORA stops in far departments: don't force onto corridor driver.
          // Leave them unassigned so the user can assign to a transportadora manually,
          // UNLESS the stop has no lat (can't be routed anyway) or it's close to the corridor.
          if (stop.type === 'TRANSPORTADORA' && !this._isOnCorridor(stop, corridor)) {
            // Leave unassigned — will show as "sin chofer" in Step 2
            assigned = true; // skip but don't assign
            break;
          }
          result[stop.id] = driver.driverId;
          assigned = true;
          break;
        }
      }
      if (assigned) continue;

      // Interior dept but no corridor driver available:
      // TRANSPORTADORA: never auto-assign (must be manual — carrier or driver)
      // Regular interior stop: assign to first available corridor driver
      if (this.INTERIOR_DEPTS.has(stop.dept)) {
        if (stop.type !== 'TRANSPORTADORA' && corridorDrivers.length) {
          result[stop.id] = corridorDrivers[0].driverId;
        }
        // else: leave unassigned → appears as "sin chofer" in Step 2
        continue;
      }

      // Urban or no corridor → cluster geographically
      urbanLeftover.push(stop);
    }

    // ── Paso 2: paradas urbanas → k-means geográfico ──
    const urbanAssignees = [
      ...activeDrivers.filter(a => !a.corridorKey),
      ...(session.carrierAssignments||[]).map(a => ({ driverId: a.carrierId })),
    ];

    if (urbanLeftover.length && urbanAssignees.length) {
      // Pre-agrupar puntos en la misma ubicación (~15m tolerance).
      // Garantiza que SASPY CARE y SASPY SHOP (mismas coords) queden juntos.
      const TOL = 0.00015;
      const locKey = s => Math.round(s.lat/TOL) + '_' + Math.round(s.lng/TOL);
      const groupsMap = {};
      for (const s of urbanLeftover) {
        const k = locKey(s);
        if (!groupsMap[k]) groupsMap[k] = { lat: s.lat, lng: s.lng, stops: [] };
        groupsMap[k].stops.push(s);
      }
      const groups = Object.values(groupsMap);

      // K-means sobre los puntos únicos (centroide por ubicación)
      const k = Math.min(urbanAssignees.length, groups.length);
      const clusters = this.geoKMeans(groups, k);

      // Ordenar clusters de oeste a este — asignación predecible
      clusters.sort((a, b) => this.clusterCenter(a).lng - this.clusterCenter(b).lng);

      // Cada cluster → un asignado. Todas las paradas de cada grupo del cluster
      // (incluyendo paradas en la misma ubicación) van al mismo chofer.
      clusters.forEach((cluster, idx) => {
        const assignee = urbanAssignees[idx % urbanAssignees.length];
        for (const group of cluster) {
          for (const stop of group.stops) {
            result[stop.id] = assignee.driverId;
          }
        }
      });
    } else if (urbanLeftover.length && activeDrivers.length) {
      // Sin urbanos disponibles → todo al primer chofer activo
      for (const s of urbanLeftover) result[s.id] = activeDrivers[0].driverId;
    }

    return result;
  },

  // Check if a stop is reasonably close to a corridor (within 150km perpendicular)
  _isOnCorridor(stop, corridor) {
    let minPerp = Infinity;
    const wps = corridor.waypoints;
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i+1];
      const dx = b.lng - a.lng, dy = b.lat - a.lat;
      const len2 = dx*dx + dy*dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((stop.lng-a.lng)*dx + (stop.lat-a.lat)*dy) / len2));
      const perp = this.haversine(stop, {lat: a.lat+t*dy, lng: a.lng+t*dx});
      if (perp < minPerp) minPerp = perp;
    }
    return minPerp < 150; // within 150km of corridor
  },

  // ── K-means geográfico ─────────────────────────────────────────────────
  // Inicialización determinista: ordena por lat+lng, toma puntos a intervalos iguales
  geoKMeans(points, k, maxIter = 40) {
    if (!points.length) return [];
    k = Math.min(k, points.length);
    if (k === 1) return [points.slice()];

    const sorted = points.slice().sort((a,b) => (a.lat*0.7 + a.lng*0.3) - (b.lat*0.7 + b.lng*0.3));
    const step = Math.floor(sorted.length / k);
    let centroids = Array.from({length: k}, (_, i) => ({
      lat: sorted[Math.min(i * step, sorted.length-1)].lat,
      lng: sorted[Math.min(i * step, sorted.length-1)].lng,
    }));

    let clusters = [];
    for (let iter = 0; iter < maxIter; iter++) {
      clusters = Array.from({length: k}, () => []);
      for (const p of points) {
        let best = 0, bestD = Infinity;
        for (let ci = 0; ci < centroids.length; ci++) {
          const dlat = p.lat - centroids[ci].lat, dlng = p.lng - centroids[ci].lng;
          const d = dlat*dlat + dlng*dlng;
          if (d < bestD) { bestD = d; best = ci; }
        }
        clusters[best].push(p);
      }
      // Evitar clusters vacíos: mover el punto más lejano del cluster más grande
      for (let i = 0; i < k; i++) {
        if (!clusters[i].length) {
          let lg = 0;
          for (let j = 0; j < k; j++) if (clusters[j].length > clusters[lg].length) lg = j;
          let far = clusters[lg][0], farD = -1;
          for (const p of clusters[lg]) {
            const d = (p.lat-centroids[lg].lat)**2 + (p.lng-centroids[lg].lng)**2;
            if (d > farD) { farD = d; far = p; }
          }
          clusters[lg] = clusters[lg].filter(p => p !== far);
          clusters[i].push(far);
        }
      }
      let moved = false;
      for (let i = 0; i < k; i++) {
        if (!clusters[i].length) continue;
        const nL = clusters[i].reduce((s,p) => s + p.lat, 0) / clusters[i].length;
        const nG = clusters[i].reduce((s,p) => s + p.lng, 0) / clusters[i].length;
        if (Math.abs(nL - centroids[i].lat) > 0.00005 || Math.abs(nG - centroids[i].lng) > 0.00005) {
          centroids[i] = { lat: nL, lng: nG };
          moved = true;
        }
      }
      if (!moved) break;
    }
    return clusters;
  },

  clusterCenter(cluster) {
    if (!cluster.length) return { lat: 0, lng: 0 };
    return {
      lat: cluster.reduce((s,p) => s + p.lat, 0) / cluster.length,
      lng: cluster.reduce((s,p) => s + p.lng, 0) / cluster.length,
    };
  },


  // ── Insertar descansos por tiempo real de conducción ──────────────────
  // La pausa se inserta en el momento EXACTO en que se cumple el intervalo,
  // y desplaza los horarios de todas las paradas siguientes (+30min).
  insertBreaks(steps, breakInterval) {
    if (!breakInterval || breakInterval <= 0) return steps;

    const result = [];
    let drivingAccum = 0;  // segundos conducidos desde el último descanso
    let timeShift    = 0;  // segundos totales añadidos por descansos
    let prevDepart   = steps.length ? steps[0].arrival : 0; // salida del punto anterior (tiempo original)

    for (const step of steps) {
      if (step.type !== 'job') {
        result.push({ ...step, arrival: step.arrival + timeShift });
        if (step.type === 'start') prevDepart = step.arrival;
        continue;
      }

      // Conducción de este tramo (sin shift, tiempo original de la solución)
      const legDriving = Math.max(0, step.arrival - prevDepart);

      // ¿Cruzamos el umbral de descanso durante este tramo?
      while (drivingAccum + legDriving >= breakInterval) {
        // Momento exacto en que se completan N horas de conducción
        const remainingToBreak = breakInterval - drivingAccum;
        const breakArrival = prevDepart + timeShift + remainingToBreak;

        result.push({
          type:     'break',
          arrival:  breakArrival,
          duration: 1800,   // 30 min obligatorio
          stopId:   null,
        });

        timeShift    += 1800;
        drivingAccum  = 0;
        // El resto del tramo después del descanso cuenta para el siguiente intervalo
        // (en un solo tramo no suele haber más de un descanso, pero el while lo cubre)
        break; // solo un descanso por tramo (el while protege casos extremos)
      }

      drivingAccum += legDriving;

      result.push({ ...step, arrival: step.arrival + timeShift });
      prevDepart = step.arrival + (step.service || 0); // tiempo original de salida
    }

    return result;
  },

  // ── Optimización principal ────────────────────────────────────────────
  async optimize(session, onProgress) {
    // Día de la semana de la ruta (0=domingo..6=sábado) — usado por _opens/_closes
    // para elegir el horario correcto en paradas con hoursByDay (horario distinto por día).
    this._routeDay = this._dayOfWeek(session.date);

    const allStops = Storage.getStops();
    const drivers  = Storage.getDrivers();
    const carriers = Storage.getCarriers();
    const sMap     = Object.fromEntries(allStops.map(s => [s.id, s]));
    const dMap     = Object.fromEntries(drivers.map(d => [d.id, d]));
    const cMap     = Object.fromEntries(carriers.map(c => [c.id, c]));
    const depot    = allStops.find(s => s.type === 'DEPOT');
    if (!depot?.lat) throw new Error('El CDD no tiene coordenadas.');

    const apiKey = Storage.getApiKey();

    const stopsByAssigned = {};
    for (const [stopId, qty] of Object.entries(session.packages)) {
      if (!qty || qty <= 0) continue;
      const assignedId = session.stopAssignments?.[stopId];
      if (!assignedId) continue;
      const stop = sMap[stopId];
      if (!stop || stop.lat === null) continue;
      if (!stopsByAssigned[assignedId]) stopsByAssigned[assignedId] = [];
      stopsByAssigned[assignedId].push(stop);
    }

    const allRoutes = [];
    const allUnassigned = Object.entries(session.packages)
      .filter(([id, qty]) => qty > 0 && !session.stopAssignments?.[id])
      .map(([id]) => ({ stopId: id, reason: 'Sin chofer asignado' }));

    // ── Carrier virtual stops ──────────────────────────────────────────────
    // When a carrier has a delivery driver assigned, add ONE virtual stop
    // at the CARRIER'S physical address (depot) to that driver's route.
    // This represents JORGE driving to "Zona Terminal" and depositing packages.
    for (const ca of (session.carrierAssignments || [])) {
      if (!ca.deliveryDriverId) continue;              // no driver linked → skip
      const carrier = cMap[ca.carrierId];
      if (!carrier?.lat) continue;                     // no coords → skip

      // Sum packages for this carrier
      const totalPkgs = Object.entries(session.packages)
        .filter(([id]) => session.stopAssignments?.[id] === ca.carrierId)
        .reduce((sum, [, qty]) => sum + (qty || 0), 0);
      if (!totalPkgs) continue;

      // Virtual stop at carrier's depot location
      const vid = '__carrier__' + ca.carrierId;
      const virtualStop = {
        id: vid, name: 'Entregar a ' + (carrier.name || 'Transportadora'),
        lat: carrier.lat, lng: carrier.lng,
        type: 'TRANSPORTADORA',
        opens: carrier.opens || null, closes: carrier.closes || null,
        _isVirtual: true, _carrierId: ca.carrierId, _carrierName: carrier.name,
        _totalPkgs: totalPkgs,
      };

      if (!stopsByAssigned[ca.deliveryDriverId]) stopsByAssigned[ca.deliveryDriverId] = [];
      stopsByAssigned[ca.deliveryDriverId].push(virtualStop);
      // Inject into packages so _svc() works
      session = { ...session, packages: { ...session.packages, [vid]: totalPkgs } };
    }

    const totalDrivers = session.assignments.filter(a => (stopsByAssigned[a.driverId]||[]).length > 0).length;
    let done = 0;

    for (let ai = 0; ai < session.assignments.length; ai++) {
      const asgn        = session.assignments[ai];
      const driverStops = stopsByAssigned[asgn.driverId] || [];
      if (!driverStops.length) continue;

      const driver     = dMap[asgn.driverId];
      const driverStopsMap = Object.fromEntries(driverStops.map(s => [s.id, s]));
      const depTime    = timeToSecs(asgn.departureTime || '06:00');
      // Cada chofer puede salir un día calendario distinto al de la sesión
      // (ej. sesión armada el 25/08 a la tarde, pero un chofer sale recién
      // el 26/08 de madrugada) — usar SU día real para elegir el horario
      // correcto en paradas con hoursByDay (horario distinto por día).
      this._routeDay   = this._dayOfWeek(asgn.departureDate || session.date);
      // Si el chofer arranca su día desde otro lugar (ej. vive/opera en otra
      // ciudad, como un chofer de Ciudad del Este que no viaja desde el CDD
      // cada mañana), usar esa ubicación como punto de partida en vez del CDD.
      const startPoint = (asgn.startsAtHome && driver?.homeLat != null)
        ? { lat: driver.homeLat, lng: driver.homeLng }
        : depot;
      const isInterior = driverStops.some(s => this.INTERIOR_DEPTS.has(s.dept));
      const corridorKey = this._corridorKeyFromDriver(driver);
      const corridor     = corridorKey ? this.CORRIDORS[corridorKey] : null;

      onProgress && onProgress(done, totalDrivers, driver?.name || 'Chofer');

      // Prioridad: motor propio (VROOM, si está configurado) > ORS Matrix > Haversine estimado
      let solution = null, totalDist = 0, routeGeometry = null;
      const vroomCfg = Storage.getVroomConfig();
      if (vroomCfg && vroomCfg.url) {
        try {
          const result = await this.solveWithVroom(startPoint, driverStops, depTime, session.packages, driver, asgn.endsAtHome, vroomCfg);
          solution = result.steps;
          totalDist = result.distance;
          routeGeometry = result.geometry;
          if (result.unassigned && result.unassigned.length) {
            // No se descartan: se agregan igual al final de la ruta, marcadas
            // como posible atraso — el chofer decide si las hace o no.
            const lateStops = result.unassigned.map(id => driverStopsMap[id]).filter(Boolean);
            this._appendLateStops(solution, lateStops, startPoint, driverStopsMap, depTime, session.packages);
            onProgress && onProgress(done, totalDrivers, (driver?.name||'?') + ` (motor propio ✓, ${result.unassigned.length} agregadas con aviso de atraso)`);
          } else {
            onProgress && onProgress(done, totalDrivers, (driver?.name||'?') + ' (motor propio ✓)');
          }
        } catch(e) {
          onProgress && onProgress(done, totalDrivers, (driver?.name||'?') + ' ⚠️ motor propio falló: ' + e.message);
        }
      }

      if (!solution) {
        const points = [startPoint, ...driverStops];
        let matrix;

        // Obtener matriz de tiempos reales desde ORS (cuando hay API key)
        // Sin API key → Haversine con velocidades estimadas (menos preciso)
        if (apiKey) {
          try {
            matrix = await this.fetchMatrix(points, apiKey);
            onProgress && onProgress(done, totalDrivers, (driver?.name||'?') + ' (ORS ✓)');
          } catch(e) {
            // ORS falló — caer en Haversine con advertencia clara
            matrix = this.buildLocalMatrix(points, isInterior);
            onProgress && onProgress(done, totalDrivers, (driver?.name||'?') + ' ⚠️ ORS falló: ' + e.message);
          }
        } else {
          matrix = this.buildLocalMatrix(points, isInterior);
          onProgress && onProgress(done, totalDrivers, (driver?.name||'?') + ' (sin API Key — tiempos estimados)');
        }

        solution = this.solveLocal(driverStops, matrix, depTime, session.packages, startPoint, isInterior, corridor);

        let prevNode = 0;
        solution.forEach(s => {
          const idx = driverStops.findIndex(x => x.id === s.stopId);
          if (idx >= 0) { totalDist += matrix.distances[prevNode][idx+1]; prevNode = idx+1; }
        });
      }

      solution = this.applyTrafficFactor(solution, depTime, driverStopsMap);

      const endTime = solution.length
        ? solution[solution.length-1].arrival + solution[solution.length-1].service
        : depTime;

      const rawSteps = [
        { type:'start', arrival:depTime, stopId:null },
        ...solution.map(s => ({ type:'job', arrival:s.arrival, service:s.service, stopId:s.stopId, travelTime:s.travelTime, late:!!s.late })),
        { type:'end', arrival:endTime, stopId:null },
      ];
      // Default: interior drivers get 4h breaks even if session was saved before this feature
      // Descansos: interior → default 4h; ciudad → 0 a menos que el usuario lo configure explícitamente
      const breakInterval = isInterior
        ? ((asgn.breakInterval != null) ? asgn.breakInterval : 14400)
        : (asgn.breakInterval > 0 ? asgn.breakInterval : 0);
      const stepsWithBreaks = this.insertBreaks(rawSteps, breakInterval);

      allRoutes.push({
        vehicleIdx: ai, duration: endTime-depTime, distance: totalDist, isCarrier: false,
        breakInterval: breakInterval, geometry: routeGeometry,
        steps: stepsWithBreaks,
      });

      done++;
      // Pausa entre llamadas a ORS
      if (apiKey && ai < session.assignments.length-1) await new Promise(r => setTimeout(r, 500));
    }

    // Transportadoras
    for (const ca of (session.carrierAssignments||[])) {
      const cStops = stopsByAssigned[ca.carrierId] || [];
      if (!cStops.length) continue;
      const carrier = cMap[ca.carrierId];
      allRoutes.push({
        vehicleIdx: null, carrierId: ca.carrierId,
        carrierName: carrier?.name || 'Transportadora',
        duration: 0, distance: 0, isCarrier: true,
        steps: cStops.map(s => ({ type:'job', arrival:0, service:0, stopId:s.id })),
      });
    }

    onProgress && onProgress(totalDrivers, totalDrivers, 'Completado');
    if (!allRoutes.length) throw new Error('No se genero ninguna ruta.');
    return { routes: allRoutes, unassigned: allUnassigned };
  },

  // ── Solver: corredor real → ventanas de tiempo → 2-opt ────────────────
  // ── SWEEP Algorithm: Barrido angular desde depot ────────────────────────
  // Agrupa paradas en "sectores" geográficos → menos cruces, mejor local
  sweepAlgorithm(stops, depot) {
    const n = stops.length;
    if (n === 0) return [];
    
    // Calcular ángulo polar de cada parada respecto al depot
    const angles = stops.map((s, i) => {
      const dy = s.lat - depot.lat;
      const dx = s.lng - depot.lng;
      const angle = Math.atan2(dy, dx); // -π a π
      return { i, angle, dist: this.haversine(depot, s) };
    });
    
    // Ordenar por ángulo (crea "barridoo" desde 0° a 360°)
    angles.sort((a, b) => {
      // Si ángulos cerca, ordenar por distancia (cercanas primero)
      const angleDiff = a.angle - b.angle;
      if (Math.abs(angleDiff) > 0.2) return angleDiff; // > ~11°
      return a.dist - b.dist; // dentro del sector, por distancia
    });
    
    return angles.map(x => x.i);
  },

  solveLocal(stops, matrix, depTime, packages, depot, isInterior, corridor) {
    const n = stops.length;
    if (n === 0) return [];

    let order;
    let isCorridor = false;

    if (corridor) {
      // Corredor: ordenar por km acumulados sobre la polilínea (CDD → destino)
      isCorridor = true;
      order = stops
        .map((s, i) => ({ i, pos: this.corridorPosition(s, corridor) }))
        .sort((a, b) => a.pos - b.pos)
        .map(x => x.i);

    } else if (isInterior) {
      // Interior sin corredor: orden por distancia al CDD
      order = stops
        .map((s, i) => ({ i, dist: this.haversine(depot, s) }))
        .sort((a, b) => a.dist - b.dist)
        .map(x => x.i);

    } else {
      // Ciudad: nearest-neighbor sobre la matriz real
      // Evita zigzag mejor que sweep angular en zona urbana densa
      order = this.nearestNeighborOrder(stops, matrix, packages, depTime);
    }

    if (isCorridor) {
      // CORREDOR: ida + vuelta sobre la misma ruta.
      // Las paradas que no caben en la ida (ventana de horario) se visitan
      // en el regreso (misma carretera en sentido contrario).
      return this.corridorRoute(order, stops, matrix, packages, depTime);
    }

    // Ciudad / interior sin corredor: ajustar ventanas, luego pulir con 2-opt + or-opt
    order = this.enforceWindows(order, stops, matrix, depTime, packages, false);
    order = this.polishRoute(order, stops, matrix, packages, depTime);
    return this.replayRoute(order, stops, matrix, packages, depTime);
  },

  // Alterna 2-opt (intercambia tramos) y or-opt (reubica una parada individual)
  // hasta que ninguno mejore más — juntos encuentran mejores secuencias que
  // 2-opt solo, sin tocar cómo se reparten las paradas entre choferes.
  polishRoute(order, stops, matrix, packages, depTime) {
    const n = stops.length;
    // Rutas muy largas: cada pasada es O(n^3) — limitar pasadas (y saltar or-opt en rutas gigantes)
    // para no trabar el navegador en el caso raro de un chofer con decenas de paradas.
    const maxPasses = n > 60 ? 1 : n > 30 ? 2 : 5;
    let cost = this.routeCostPenalized(this.replayRoute(order, stops, matrix, packages, depTime), stops, depTime);
    for (let pass = 0; pass < maxPasses; pass++) {
      order = this.twoOpt(order, stops, matrix, packages, depTime);
      if (n <= 90) order = this.orOpt(order, stops, matrix, packages, depTime);
      const newCost = this.routeCostPenalized(this.replayRoute(order, stops, matrix, packages, depTime), stops, depTime);
      if (newCost >= cost - 1) break;
      cost = newCost;
    }
    return order;
  },

  // 2-opt restringido a swaps adyacentes — seguro para rutas de corredor
  twoOptAdjacent(route, stops, matrix, packages, depTime) {
    let best = route.slice();
    let bestCost = this.routeCostPenalized(this.replayRoute(best, stops, matrix, packages, depTime), stops, depTime);
    let improved = true;
    let iter = 0;
    while (improved && iter < 5) {
      improved = false; iter++;
      for (let i = 0; i < best.length - 1; i++) {
        const cand = best.slice();
        [cand[i], cand[i+1]] = [cand[i+1], cand[i]];
        const cost = this.routeCostPenalized(this.replayRoute(cand, stops, matrix, packages, depTime), stops, depTime);
        if (cost < bestCost - 30) { best = cand; bestCost = cost; improved = true; }
      }
    }
    return best;
  },

  // Nearest-neighbor con ventanas de tiempo integradas
  // Prioriza paradas que cierran pronto para no perderlas
  nearestNeighborOrder(stops, matrix, packages, depTime) {
    const n = stops.length;
    const visited = new Array(n).fill(false);
    const order = [];
    let cur = 0, time = depTime;

    for (let iter = 0; iter < n; iter++) {
      let bestJ = -1, bestScore = Infinity;

      // Paso 1: candidatos que aún están dentro de su ventana
      for (let j = 0; j < n; j++) {
        if (visited[j]) continue;
        const travel  = matrix.durations[cur][j + 1];
        const arr     = Math.max(time + travel, this._opens(stops[j], depTime));
        const closes  = this._closes(stops[j], depTime);
        if (arr > closes) continue; // ya cerró, lo dejamos para el fallback

        // Score: tiempo de viaje base + bonus de urgencia (cierra pronto = score más bajo)
        const timeLeft = closes - arr;
        const urgency  = timeLeft < 2 * 3600 ? (2 * 3600 - timeLeft) * 3 : 0;
        const score    = travel - urgency;
        if (score < bestScore) { bestScore = score; bestJ = j; }
      }

      // Paso 2: fallback - si ninguno es factible, tomar el más cercano
      if (bestJ === -1) {
        let bestD = Infinity;
        for (let j = 0; j < n; j++) {
          if (!visited[j] && matrix.durations[cur][j + 1] < bestD) {
            bestD = matrix.durations[cur][j + 1]; bestJ = j;
          }
        }
      }
      if (bestJ === -1) break;

      visited[bestJ] = true;
      order.push(bestJ);
      const travel = matrix.durations[cur][bestJ + 1];
      const arr    = Math.max(time + travel, this._opens(stops[bestJ], depTime));
      time = arr + this._svc(stops[bestJ], packages);
      cur  = bestJ + 1;
    }
    return order;
  },

  enforceWindows(order, stops, matrix, depTime, packages, isCorridor = false) {
    const result = [], remaining = order.slice();
    let cur = 0, time = depTime;

    while (remaining.length) {
      const feasible = [], infeasible = [];

      for (let k = 0; k < remaining.length; k++) {
        const j      = remaining[k];
        const travel = matrix.durations[cur][j + 1];
        const arr    = Math.max(time + travel, this._opens(stops[j], depTime));
        const closes = this._closes(stops[j], depTime);
        if (arr <= closes) {
          feasible.push({ k, j, closes, urgency: closes - arr });
        } else {
          infeasible.push({ k, j, lateness: arr - closes });
        }
      }

      let picked;
      if (feasible.length > 0) {
        if (isCorridor) {
          // Corredor: mirar los primeros 5 (preservar orden de ruta) y elegir el más urgente
          const look = feasible.slice(0, 5);
          look.sort((a, b) => a.closes - b.closes);
          picked = look[0].k;
        } else {
          // Ciudad: EDF completo — escanear TODOS y elegir el que cierra antes
          feasible.sort((a, b) => a.closes - b.closes);
          picked = feasible[0].k;
        }
      } else {
        // Ninguno factible: tomar el menos tardío (mínimo lateness)
        infeasible.sort((a, b) => a.lateness - b.lateness);
        picked = infeasible[0].k;
      }

      const j      = remaining.splice(picked, 1)[0];
      result.push(j);
      const travel = matrix.durations[cur][j + 1];
      const arr    = Math.max(time + travel, this._opens(stops[j], depTime));
      time = arr + this._svc(stops[j], packages);
      cur  = j + 1;
    }
    return result;
  },

  twoOpt(route, stops, matrix, packages, depTime) {
    let best     = route.slice();
    let bestCost = this.routeCostPenalized(this.replayRoute(best, stops, matrix, packages, depTime), stops, depTime);
    let improved = true;
    while (improved) {
      improved = false;
      outer:
      for (let i = 0; i < best.length - 1; i++) {
        for (let j = i + 2; j < best.length; j++) {
          const cand = [...best.slice(0, i+1), ...best.slice(i+1, j+1).reverse(), ...best.slice(j+1)];
          const cost = this.routeCostPenalized(this.replayRoute(cand, stops, matrix, packages, depTime), stops, depTime);
          if (cost < bestCost - 30) { best = cand; bestCost = cost; improved = true; break outer; }
        }
      }
    }
    return best;
  },

  // Or-opt: prueba reubicar cada parada, una por una, en cualquier otra posición
  // de la ruta. Encuentra mejoras que 2-opt no ve (ej: una parada aislada que
  // conviene visitar al principio o al final en vez de en medio del recorrido).
  orOpt(route, stops, matrix, packages, depTime) {
    let best     = route.slice();
    let bestCost = this.routeCostPenalized(this.replayRoute(best, stops, matrix, packages, depTime), stops, depTime);
    let improved = true;
    while (improved) {
      improved = false;
      outer:
      for (let i = 0; i < best.length; i++) {
        for (let j = 0; j <= best.length; j++) {
          if (j === i || j === i + 1) continue; // misma posición, no es un movimiento real
          const cand = best.slice();
          const [node] = cand.splice(i, 1);
          const insertAt = j > i ? j - 1 : j;
          cand.splice(insertAt, 0, node);
          const cost = this.routeCostPenalized(this.replayRoute(cand, stops, matrix, packages, depTime), stops, depTime);
          if (cost < bestCost - 30) { best = cand; bestCost = cost; improved = true; break outer; }
        }
      }
    }
    return best;
  },

  // Costo con penalización pesada por llegar fuera de ventana
  routeCostPenalized(replayed, stops, depTime) {
    if (!replayed.length) return 0;
    let penalty = 0;
    for (const step of replayed) {
      const stop = stops.find(s => s.id === step.stopId);
      if (!stop) continue;
      const closes = this._closes(stop, depTime);
      if (step.arrival > closes) penalty += (step.arrival - closes) * 10;
    }
    const last = replayed[replayed.length - 1];
    return last.arrival + last.service + penalty;
  },

  routeCost(r) { return r.length ? r[r.length-1].arrival + r[r.length-1].service : 0; },

  // ── Ruta de corredor con retorno ──────────────────────────────────────
  // Divide las paradas en "ida" (km creciente) y "vuelta" (km decreciente).
  // Una parada va en la vuelta si:
  //   a) No es alcanzable en la ida antes de que cierre, O
  //   b) Requiere espera > 2h en la ida Y en la vuelta llega en ventana
  corridorRoute(order, stops, matrix, packages, depTime) {
    const outbound = [];   // índices en orden corredor (ida)
    const returnLeg = [];  // índices en orden corredor inverso (vuelta)

    let cur  = 0;          // nodo actual en la matriz (0 = depot)
    let time = depTime;

    // ── Simular ida en orden de corredor ──────────────────────────────────
    for (const idx of order) {
      const travel   = matrix.durations[cur][idx + 1];
      const rawArr   = time + travel;
      const opens    = this._opens(stops[idx], depTime);
      const closes   = this._closes(stops[idx], depTime);
      const waitTime = Math.max(0, opens - rawArr);
      const effArr   = rawArr + waitTime;

      // Si llega tarde O tiene que esperar más de 2h → candidato para vuelta
      if (effArr > closes || waitTime > 2 * 3600) {
        returnLeg.push(idx);
      } else {
        outbound.push(idx);
        time = effArr + this._svc(stops[idx], packages);
        cur  = idx + 1;
      }
    }

    // ── Simular vuelta (orden inverso del corredor) ───────────────────────
    // El regreso empieza desde la posición actual (último stop de la ida)
    // y recorre las paradas de vuelta de mayor km a menor km.
    const returnOrder = [];

    for (const idx of returnLeg) {
      const travel   = matrix.durations[cur][idx + 1];
      const rawArr   = time + travel;
      const opens    = this._opens(stops[idx], depTime);
      const closes   = this._closes(stops[idx], depTime);
      const waitTime = Math.max(0, opens - rawArr);
      const effArr   = rawArr + waitTime;

      // En la vuelta: incluir siempre (si cerró también, es mejor tarde que nunca)
      returnOrder.push(idx);
      time = Math.max(rawArr, opens) + this._svc(stops[idx], packages);
      cur  = idx + 1;
    }

    const finalOrder = [...outbound, ...returnOrder];
    return this.replayRoute(finalOrder, stops, matrix, packages, depTime);
  },

  replayRoute(route, stops, matrix, packages, depTime) {
    const result=[]; let cur=0, time=depTime;
    for (const idx of route) {
      const travelTime = matrix.durations[cur][idx+1];
      const arr = Math.max(time + travelTime, this._opens(stops[idx], depTime));
      const svc = this._svc(stops[idx], packages);
      result.push({ stopId:stops[idx].id, arrival:arr, service:svc, travelTime });
      time = arr + svc; cur = idx+1;
    }
    return result;
  },

  // 'YYYY-MM-DD' → 0=domingo..6=sábado (día calendario real de la ruta)
  _dayOfWeek(dateStr) {
    const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
    return isNaN(d) ? new Date().getDay() : d.getDay();
  },

  // Si la parada tiene horario distinto por día (hoursByDay, ej. importado de la
  // API de lockers) usa el de HOY (this._routeDay); si ese día no está documentado
  // o la parada no tiene hoursByDay, cae al horario general (opens/closes de siempre).
  _effectiveHours(s) {
    if (s.hoursByDay && this._routeDay != null) {
      const h = s.hoursByDay[this._routeDay];
      if (h === null) return { opens: '00:00', closes: '00:00' }; // día marcado explícitamente cerrado
      if (h) return h; // horario propio de ese día
    }
    return { opens: s.opens, closes: s.closes };
  },

  // depTime: hora de salida en segundos — necesaria para rutas nocturnas
  _opens(s, depTime) {
    const eff = this._effectiveHours(s);
    // 24h stop (opens=null): siempre abierto — nunca esperar
    if (!eff.opens) return 0;
    const raw = timeToSecs(eff.opens);
    if (!depTime) return raw;
    // Ruta nocturna: si la apertura es mañana temprano, correr al día siguiente
    return (depTime >= 18*3600 && raw < depTime && raw < 12*3600) ? raw + 86400 : raw;
  },
  _closes(s, depTime) {
    const eff = this._effectiveHours(s);
    let raw;
    if (!eff.closes) {
      // 24 horas: si salida nocturna, extender hasta el doble del día siguiente
      raw = (depTime >= 18*3600) ? 86400 * 2 : 86400;
    } else {
      const c = timeToSecs(eff.closes);
      raw = (c === 0 || c <= timeToSecs(eff.opens||'00:00')) ? 86400 : c;
      // Corrección nocturna: si el cierre ya pasó y la apertura es mañana, sumar 86400
      if (depTime >= 18*3600 && raw < depTime && raw < 12*3600) raw += 86400;
    }
    return raw;
  },
  _svc(s, packages) {
    const p = packages[s.id] || 1;
    // Tiempo de servicio = Estacionar (180s) + Bajar (120s) + Por paquete (120s c/u)
    // Mínimo 5 min (300s), máximo 35 min (2100s)
    const serviceTime = 180 + 120 + (p * 120);
    return Math.min(2100, Math.max(300, serviceTime));
  },
};
