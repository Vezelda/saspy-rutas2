// daily.js — Constructor diario de rutas (4 pasos)

const Daily = {

  session: null,
  step: 1,
  stopSearch2: '',
  stopTypeFilter2: 'ALL',
  dragRI: null,
  dragSI: null,
  _viewingHistory: false,

  // ── Sesion ────────────────────────────────────────────────────────────────
  init() {
    this._viewingHistory = false;
    const saved = localStorage.getItem('saspy_daily');
    try { this.session = saved ? JSON.parse(saved) : this.fresh(); }
    catch(e) { this.session = this.fresh(); }
    this.step = this.session.results ? 4 : 1;
    this.render();
  },

  fresh() {
    return {
      date: new Date().toISOString().slice(0,10),
      assignments: [],
      packages: {},
      stopAssignments: {},
      carrierAssignments: [],
      results: null,
      unassigned: [],
    };
  },

  // Mientras se está viendo el historial (solo lectura) no se persiste nada
  // en la sesión del día actual — evita que un drag/borrar sobrescriba lo real.
  save() {
    if (this._viewingHistory) return;
    localStorage.setItem('saspy_daily', JSON.stringify(this.session));
  },

  newDay() {
    if (!confirm('Empezar un nuevo dia? Se borrara la sesion actual.')) return;
    if (this.session?.results) Storage.archiveDailySession(this.session);
    localStorage.removeItem('saspy_daily');
    this.session = this.fresh();
    this.step = 1;
    this.render();
  },

  // ── Historial ────────────────────────────────────────────────────────────
  showHistory() {
    const history = Storage.getDailyHistory();
    const rows = history.map(h => {
      const nDrivers = (h.assignments||[]).length + (h.carrierAssignments||[]).length;
      const nStops   = (h.results||[]).reduce((sum, r) => sum + r.steps.filter(s=>s.type==='job').length, 0);
      const km       = (h.results||[]).reduce((sum, r) => sum + (r.distance||0), 0) / 1000;
      return `<tr>
        <td>${esc(fmtDate(h.date))}</td>
        <td>${nDrivers}</td>
        <td>${nStops}</td>
        <td>${km.toFixed(0)} km</td>
        <td class="td-actions">
          <button class="btn-sm btn-ghost" onclick="Daily.viewHistoryEntry('${h.date}')">Ver</button>
          <button class="btn-sm btn-danger" onclick="Daily.deleteHistoryEntry('${h.date}')">Borrar</button>
        </td>
      </tr>`;
    }).join('');

    App.showModal(`
      <div class="modal-header"><h2>Historial de rutas</h2></div>
      <div class="modal-body">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Fecha</th><th>Choferes</th><th>Paradas</th><th>Distancia</th><th>Acciones</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty-row">Todavía no hay días archivados</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="App.closeModal()">Cerrar</button>
      </div>
    `);
  },

  viewHistoryEntry(date) {
    const entry = Storage.getDailyHistory().find(h => h.date === date);
    if (!entry) return;
    App.closeModal();
    this.session = JSON.parse(JSON.stringify(entry)); // copia — no tocar el original
    this._viewingHistory = true;
    this.step = 4;
    this.render();
  },

  deleteHistoryEntry(date) {
    if (!confirm('¿Borrar el historial del ' + fmtDate(date) + '? No se puede deshacer.')) return;
    Storage.deleteDailyHistoryEntry(date);
    this.showHistory();
  },

  exitHistoryView() {
    this.init(); // recarga la sesión real del día actual desde localStorage
  },

  // ── Render principal ──────────────────────────────────────────────────────
  render() {
    const main = document.getElementById('main');
    const STEPS = ['Choferes', 'Paquetes', 'Generar rutas', 'Revisar'];
    main.innerHTML = `
      <div class="module-header mh-row">
        <div>
          <h1>Armar ruta del dia</h1>
          <p>Selecciona choferes, carga paquetes y genera las rutas.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="date" id="daily-date" value="${this.session.date}" ${this._viewingHistory?'disabled':''}
            onchange="Daily.session.date=this.value; Daily.save();" class="date-input">
          <button class="btn" onclick="Daily.showHistory()">Historial</button>
          <button class="btn" onclick="Daily.newDay()" ${this._viewingHistory?'disabled':''}>Nuevo dia</button>
        </div>
      </div>
      ${this._viewingHistory ? `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:13px;color:#1e40af;">📅 Viendo el historial del <strong>${esc(fmtDate(this.session.date))}</strong> — solo lectura</span>
          <button class="btn btn-sm" onclick="Daily.exitHistoryView()">Volver al día de hoy</button>
        </div>` : ''}
      <div class="step-bar">
        ${STEPS.map((l,i) => `
          <div class="step-item ${this.step===i+1?'active':this.step>i+1?'done':''}">
            <div class="step-circle">${this.step>i+1?'checkmark':i+1}</div>
            <div class="step-label">${l}</div>
          </div>
          ${i < STEPS.length-1 ? '<div class="step-line"></div>' : ''}
        `).join('')}
      </div>
      <div id="step-content" style="margin-top:1.5rem;"></div>
    `;
    // Fix checkmark display
    main.querySelectorAll('.step-circle').forEach(el => {
      if (el.textContent === 'checkmark') el.textContent = '\u2713';
    });
    if (this.step===1) this.renderStep1();
    if (this.step===2) this.renderStep2();
    if (this.step===3) this.renderStep3();
    if (this.step===4) this.renderStep4();
  },

  // ── PASO 1: Choferes ──────────────────────────────────────────────────────
  renderStep1() {
    const drivers  = Storage.getDrivers();
    const vehicles = Storage.getVehicles();
    const carriers = Storage.getCarriers();
    const vMap     = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const asgMap   = Object.fromEntries(this.session.assignments.map(a => [a.driverId, a]));
    const caMap    = Object.fromEntries((this.session.carrierAssignments||[]).map(a => [a.carrierId, a]));

    const driverCards = drivers.map(d => {
      const a   = asgMap[d.id] || { driverId:d.id, vehicleId:d.defaultVehicle, departureTime:'06:00', endsAtHome:d.canEndAtHome||false };
      const on  = !!asgMap[d.id];
      const veh = vMap[a.vehicleId];
      const vehicleOpts = vehicles.map(v =>
        '<option value="' + v.id + '"' + (a.vehicleId===v.id?' selected':'') + '>' + esc(v.name) + '</option>'
      ).join('');
      const homeOpt = d.canEndAtHome ? `
        <div class="form-group">
          <label>Termina en</label>
          <select onchange="Daily.updateAsgn('${d.id}','endsAtHome',this.value==='1')">
            <option value="0" ${!a.endsAtHome?'selected':''}>CDD</option>
            <option value="1" ${a.endsAtHome?'selected':''}>Su casa</option>
          </select>
        </div>` : '';
      const isInteriorDriver = !!Optimizer._corridorKeyFromDriver(d);
      const breakVal = a.breakInterval !== undefined ? a.breakInterval : (isInteriorDriver ? 14400 : 0);
      const breakOpt = `
        <div class="form-group">
          <label>Descanso obligatorio</label>
          <select onchange="Daily.updateAsgn('${d.id}','breakInterval',parseInt(this.value))">
            <option value="0" ${breakVal===0?'selected':''}>Sin descanso</option>
            <option value="10800" ${breakVal===10800?'selected':''}>Cada 3 horas</option>
            <option value="14400" ${breakVal===14400?'selected':''}>Cada 4 horas</option>
            <option value="21600" ${breakVal===21600?'selected':''}>Cada 6 horas</option>
          </select>
        </div>`;
      return `
        <div class="driver-card ${on?'active':''}" id="dc-${d.id}">
          <div class="driver-card-header">
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="driver-avatar">${d.name.charAt(0)}</div>
              <div>
                <div class="driver-name">${esc(d.name)}</div>
                <div class="driver-veh-label">${esc(veh?.name||'Sin vehiculo')}</div>
              </div>
            </div>
            <label class="toggle-wrap">
              <input type="checkbox" ${on?'checked':''} onchange="Daily.toggleDriver('${d.id}',this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="driver-card-body" id="dcb-${d.id}" style="display:${on?'block':'none'}">
            <div class="form-row">
              <div class="form-group">
                <label>Vehiculo hoy</label>
                <select onchange="Daily.updateAsgn('${d.id}','vehicleId',this.value)">${vehicleOpts}</select>
              </div>
              <div class="form-group">
                <label>Hora de salida</label>
                <input type="time" value="${a.departureTime}"
                  onchange="Daily.updateAsgn('${d.id}','departureTime',this.value)">
              </div>
              ${homeOpt}
              ${breakOpt}
            </div>
          </div>
        </div>`;
    }).join('');

    const carrierCards = carriers.length ? `
      <p style="font-size:13px;font-weight:500;margin:1rem 0 .5rem;color:var(--text2);">Transportadoras hoy</p>
      <div class="driver-grid">
        ${carriers.map(c => {
          const on = !!caMap[c.id];
          const caAsgn = this.session.carrierAssignments?.find(a => a.carrierId === c.id);
        const deliveryDriverId = caAsgn?.deliveryDriverId || '';
        const driverOpts = '<option value="">Sin asignar</option>' +
          this.session.assignments.map(a => {
            const d = Storage.getDrivers().find(x => x.id === a.driverId);
            return '<option value="' + a.driverId + '"' + (deliveryDriverId === a.driverId ? ' selected' : '') + '>'
              + esc(d?.name || a.driverId) + '</option>';
          }).join('');
        return `
            <div class="driver-card ${on?'active':''}" id="cc-${c.id}">
              <div class="driver-card-header">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div class="driver-avatar" style="background:#fef3c7;color:#92400e;">T</div>
                  <div>
                    <div class="driver-name">${esc(c.name)}</div>
                    <div class="driver-veh-label">${esc(c.contact||'Transportadora externa')}</div>
                  </div>
                </div>
                <label class="toggle-wrap">
                  <input type="checkbox" ${on?'checked':''} onchange="Daily.toggleCarrier('${c.id}',this.checked)">
                  <span class="toggle-slider"></span>
                </label>
              </div>
              ${on ? `<div style="padding:8px 12px;border-top:1px solid var(--border2);">
                <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:4px;">Chofer que deposita</label>
                <select style="width:100%;font-size:12px;" onchange="Daily.setCarrierDriver('${c.id}',this.value)">
                  ${driverOpts}
                </select>
              </div>` : ''}
            </div>`;
        }).join('')}
      </div>` : '';

    document.getElementById('step-content').innerHTML = `
      <p style="color:var(--text2);font-size:13px;margin-bottom:1rem;">
        Activa los choferes que salen hoy y configura su vehiculo y hora de salida.
      </p>
      <div class="driver-grid">${driverCards}</div>
      ${carrierCards}
      <div class="step-footer">
        <div></div>
        <button class="btn btn-primary" onclick="Daily.goStep2()">
          Siguiente: Cargar paquetes &rarr;
        </button>
      </div>
    `;
  },

  toggleDriver(id, on) {
    const body = document.getElementById('dcb-' + id);
    const card = document.getElementById('dc-' + id);
    if (body) body.style.display = on ? 'block' : 'none';
    if (card) card.classList.toggle('active', on);
    if (on) {
      if (!this.session.assignments.find(a => a.driverId === id)) {
        const d = Storage.getDrivers().find(x => x.id === id);
        const isInterior = !!Optimizer._corridorKeyFromDriver(d);
        this.session.assignments.push({ driverId:id, vehicleId:d?.defaultVehicle||'', departureTime:'06:00', endsAtHome:d?.canEndAtHome||false, breakInterval: isInterior ? 14400 : 0 });
      }
    } else {
      this.session.assignments = this.session.assignments.filter(a => a.driverId !== id);
    }
    this.save();
  },

  toggleCarrier(id, on) {
    if (!this.session.carrierAssignments) this.session.carrierAssignments = [];
    if (on) {
      if (!this.session.carrierAssignments.some(a => a.carrierId === id))
        this.session.carrierAssignments.push({ carrierId: id, deliveryDriverId: null });
    } else {
      this.session.carrierAssignments = this.session.carrierAssignments.filter(a => a.carrierId !== id);
    }
    const card = document.getElementById('cc-' + id);
    if (card) card.classList.toggle('active', on);
    this.save();
  },

  updateAsgn(driverId, field, value) {
    const idx = this.session.assignments.findIndex(a => a.driverId === driverId);
    if (idx === -1) return;
    this.session.assignments[idx][field] = value;
    this.save();
  },

  setCarrierDriver(carrierId, driverId) {
    if (!this.session.carrierAssignments) return;
    const ca = this.session.carrierAssignments.find(a => a.carrierId === carrierId);
    if (ca) { ca.deliveryDriverId = driverId || null; this.save(); }
  },

  goStep2() {
    if (!this.session.assignments.length && !(this.session.carrierAssignments||[]).length) {
      alert('Selecciona al menos un chofer o transportadora.'); return;
    }
    // Diagnóstico: verificar paradas sin geocodificar
    const allStops = Storage.getStops();
    const missingCoords = allStops.filter(s => s.lat === null || s.lng === null);
    if (missingCoords.length > 0) {
      const list = missingCoords.map(s => '• ' + s.name).join('\n');
      const msg = missingCoords.length + ' parada(s) sin coordenadas:\n\n' + list + '\n\nVas a Configuración → Paradas para geocodificarlas.';
      alert(msg);
    }
    this.step = 2; this.render();
  },

  // ── PASO 2: Paquetes ──────────────────────────────────────────────────────
  renderStep2() {
    const total  = Object.values(this.session.packages).reduce((a,b)=>a+(b||0),0);
    const active = Object.values(this.session.packages).filter(v=>v>0).length;

    document.getElementById('step-content').innerHTML = `
      <p style="color:var(--text2);font-size:13px;margin-bottom:.875rem;">
        Ingresa cuantos paquetes van a cada parada. Las que queden en 0 no entran a la ruta.
      </p>
      <div class="toolbar">
        <div class="toolbar-left">
          <input type="search" class="search-input" placeholder="Buscar parada..."
            id="pkg-search" autocomplete="off"
            oninput="Daily.onSearch(this.value)">
          <div class="filter-pills" id="type-pills">
            ${['ALL','LOCKER','SUCURSAL','TRANSPORTADORA'].map(t =>
              '<button class="pill ' + (this.stopTypeFilter2===t?'active':'') + '" data-type="' + t + '"' +
              ' onclick="Daily.onTypeFilter(this)">' + (t==='ALL'?'Todos':t) + '</button>'
            ).join('')}
          </div>
        </div>
        <div class="toolbar-right">
          <div class="stat-chip" id="stat-chip">
            <strong>${active}</strong> paradas &middot; <strong>${total}</strong> paquetes
          </div>
          <div style="display:flex;align-items:center;gap:4px;" title="Aplica esta cantidad a todas las paradas visibles (respeta la búsqueda y el filtro de tipo)">
            <input type="number" id="bulk-qty-input" min="1" value="1"
              style="width:56px;padding:6px 8px;border:1px solid var(--border2,#ddd);border-radius:6px;font-size:13px;">
            <button class="btn" onclick="Daily.bulkFillPkgs()">Cargar a visibles</button>
          </div>
          <button class="btn" onclick="Daily.doAutoAssign()">Auto-asignar</button>
          <button class="btn btn-ghost" onclick="Daily.clearPkgs()">Limpiar</button>
        </div>
      </div>
      <div class="table-wrap" style="max-height:52vh;overflow-y:auto;">
        <table class="data-table">
          <thead>
            <tr><th>Parada</th><th>Tipo</th><th>Paquetes</th><th>Chofer / Transportadora</th></tr>
          </thead>
          <tbody id="pkg-tbody"></tbody>
        </table>
      </div>
      <div class="step-footer">
        <button class="btn" onclick="Daily.step=1; Daily.render()">&#8592; Volver</button>
        <button class="btn btn-primary" onclick="Daily.goStep3()">Generar rutas &#8594;</button>
      </div>
    `;
    this.renderPkgRows();
  },

  // Paradas visibles según búsqueda + filtro de tipo del paso 2 (usado por la tabla y por la carga masiva)
  _filteredPkgStops() {
    const stops = Storage.getStops().filter(s => s.type !== 'DEPOT' && s.lat !== null);
    const q     = (this.stopSearch2||'').toLowerCase();
    return stops.filter(s => {
      const mQ = !q || s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q);
      const mT = this.stopTypeFilter2 === 'ALL' || s.type === this.stopTypeFilter2;
      return mQ && mT;
    });
  },

  bulkFillPkgs() {
    const qty = parseInt(document.getElementById('bulk-qty-input')?.value) || 0;
    if (qty <= 0) { alert('Ingresá una cantidad válida (mayor a 0).'); return; }
    const filtered = this._filteredPkgStops();
    if (!filtered.length) { alert('No hay paradas visibles con los filtros actuales.'); return; }
    if (!confirm(`Cargar ${qty} paquete(s) a las ${filtered.length} parada(s) visibles?\n\nEsto sobreescribe la cantidad actual de esas paradas.`)) return;
    filtered.forEach(s => { this.session.packages[s.id] = qty; });
    this.save();
    this.renderPkgRows();
  },

  // Solo re-renderiza las filas — el input NO se toca, no pierde foco
  renderPkgRows() {
    const tbody = document.getElementById('pkg-tbody');
    if (!tbody) return;

    const filtered = this._filteredPkgStops();

    const drivers  = Storage.getDrivers();
    const carriers = Storage.getCarriers();
    const typeClr  = { SUCURSAL:'badge-sucursal', LOCKER:'badge-locker', TRANSPORTADORA:'badge-trans' };

    const rows = filtered.map(s => {
      const qty      = this.session.packages[s.id] || 0;
      const assigned = this.session.stopAssignments[s.id] || '';

      // Build assignee dropdown — choferes + transportadoras configuradas
      const assignedCarrier = carriers.find(c => c.id === assigned);
      let opts = '<option value="">-- asignar --</option>';
      for (const a of this.session.assignments) {
        const d = drivers.find(x => x.id === a.driverId);
        opts += '<option value="' + a.driverId + '"' + (assigned===a.driverId?' selected':'') + '>'
          + esc(d?.name||a.driverId) + '</option>';
      }
      // Separador visual
      if (carriers.length) opts += '<option disabled>──────────────</option>';
      // Todas las transportadoras disponibles (no requiere activarlas en paso 1)
      for (const c of carriers) {
        opts += '<option value="' + c.id + '"' + (assigned===c.id?' selected':'') + '>'
          + 'Transp: ' + esc(c.name) + '</option>';
      }
      const selWarn = qty > 0 && !assigned ? ' sel-warn' : '';
      const selDis  = qty === 0 ? ' disabled' : '';

      return '<tr class="' + (qty>0?'row-active':'') + '">'
        + '<td class="td-name"><div class="stop-name">' + esc(s.name) + '</div>'
        + '<div class="stop-sub">' + esc(s.city) + ' &middot; ' + (s.opens||'00:00') + '&ndash;' + (s.closes||'24:00') + '</div></td>'
        + '<td><span class="badge ' + (typeClr[s.type]||'') + '">' + s.type + '</span></td>'
        + '<td><div class="pkg-wrap">'
        + '<button class="pkg-btn" data-id="' + s.id + '" data-delta="-1" onclick="Daily.adjPkgBtn(this)">&#8722;</button>'
        + '<input type="number" class="pkg-input" min="0" value="' + qty + '" data-id="' + s.id + '"'
        + ' id="pk-' + s.id + '" onchange="Daily.setPkg(this.dataset.id,parseInt(this.value)||0)">'
        + '<button class="pkg-btn" data-id="' + s.id + '" data-delta="1" onclick="Daily.adjPkgBtn(this)">+</button>'
        + '</div></td>'
        + '<td style="min-width:140px;"><select class="assign-sel' + selWarn + '"' + selDis
        + ' data-id="' + s.id + '" onchange="Daily.setStopDriver(this.dataset.id,this.value)">'
        + opts + '</select></td>'
        + '</tr>';
    }).join('');

    tbody.innerHTML = rows || '<tr><td colspan="4" class="empty-row">Sin resultados</td></tr>';

    // Update stat chip
    const total  = Object.values(this.session.packages).reduce((a,b)=>a+(b||0),0);
    const active = Object.values(this.session.packages).filter(v=>v>0).length;
    const chip   = document.getElementById('stat-chip');
    if (chip) chip.innerHTML = '<strong>' + active + '</strong> paradas &middot; <strong>' + total + '</strong> paquetes';
  },

  onSearch(val) {
    this.stopSearch2 = val;
    this.renderPkgRows();  // No re-renderiza el input, solo la tabla
  },

  onTypeFilter(btn) {
    this.stopTypeFilter2 = btn.dataset.type;
    document.querySelectorAll('#type-pills .pill').forEach(b =>
      b.classList.toggle('active', b.dataset.type === this.stopTypeFilter2));
    this.renderPkgRows();
  },

  setPkg(stopId, qty) {
    if (qty <= 0) delete this.session.packages[stopId];
    else this.session.packages[stopId] = qty;
    this.save();
    this.renderPkgRows();
    // Restore focus to the input that triggered this
    const inp = document.getElementById('pk-' + stopId);
    if (inp) inp.focus();
  },

  adjPkgBtn(btn) {
    const id    = btn.dataset.id;
    const delta = parseInt(btn.dataset.delta);
    const cur   = this.session.packages[id] || 0;
    this.setPkg(id, Math.max(0, cur + delta));
  },

  clearPkgs() {
    if (!confirm('Limpiar todos los paquetes?')) return;
    this.session.packages = {}; this.save(); this.renderPkgRows();
  },

  setStopDriver(stopId, value) {
    if (!this.session.stopAssignments) this.session.stopAssignments = {};
    if (value) {
      this.session.stopAssignments[stopId] = value;
      // Si es una transportadora, agregarla automáticamente a carrierAssignments
      const carriers = Storage.getCarriers();
      const isCarrier = carriers.some(c => c.id === value);
      if (isCarrier) {
        if (!this.session.carrierAssignments) this.session.carrierAssignments = [];
        if (!this.session.carrierAssignments.some(a => a.carrierId === value))
          this.session.carrierAssignments.push({ carrierId: value });
      }
    } else {
      delete this.session.stopAssignments[stopId];
    }
    this.save();
    const sel = document.querySelector('select[data-id="' + stopId + '"]');
    if (sel) sel.classList.toggle('sel-warn', !value && (this.session.packages[stopId]||0) > 0);
  },

  doAutoAssign() {
    this.session.stopAssignments = Optimizer.autoAssign(this.session);
    this.save();
    this.renderPkgRows();
  },

  goStep3() {
    const active = Object.entries(this.session.packages).filter(([,v])=>v>0);
    if (!active.length) { alert('Ingresa al menos 1 paquete para generar rutas.'); return; }
    
    // Diagnóstico: verificar paradas sin coordenadas
    const sMap = Object.fromEntries(Storage.getStops().map(s => [s.id, s]));
    const missingCoords = active
      .map(([id]) => sMap[id])
      .filter(s => s && (s.lat === null || s.lng === null))
      .map(s => s.name);
    
    if (missingCoords.length > 0) {
      const list = missingCoords.join(', ');
      alert('⚠️ Paradas sin geocodificar:\n\n' + list + '\n\nNo se pueden calcular rutas sin coordenadas.\n\nVa a Configuración → Paradas para geocodificar.');
      return;
    }
    
    const unassigned = active.filter(([id]) => !this.session.stopAssignments?.[id]);
    if (unassigned.length) {
      if (!confirm(unassigned.length + ' parada(s) sin asignar seran omitidas.\n\nContinuar de todas formas?')) return;
    }
    this.session.results = null;
    this.step = 3; this.render();
  },

  // ── PASO 3: Optimizar ─────────────────────────────────────────────────────
  renderStep3() {
    const totalStops = Object.values(this.session.packages).filter(v=>v>0).length;
    const totalPkg   = Object.values(this.session.packages).reduce((a,b)=>a+(b||0),0);
    const nDrivers   = this.session.assignments.length + (this.session.carrierAssignments||[]).length;
    document.getElementById('step-content').innerHTML = `
      <div class="opt-panel">
        <div class="opt-icon">&#128507;</div>
        <h2 style="font-size:18px;font-weight:600;margin-bottom:.5rem;">Optimizacion de rutas</h2>
        <p style="color:var(--text2);font-size:13px;margin-bottom:1.5rem;max-width:420px;text-align:center;">
          Se calcularan las rutas optimas para <strong>${nDrivers}</strong> chofer/transportadora(s),
          respetando horarios de apertura y cierre de cada punto.
        </p>
        <div class="opt-summary">
          <div class="opt-stat"><strong>${nDrivers}</strong><span>asignados</span></div>
          <div class="opt-stat"><strong>${totalStops}</strong><span>paradas</span></div>
          <div class="opt-stat"><strong>${totalPkg}</strong><span>paquetes</span></div>
        </div>
        <div style="margin-top:1.5rem;">
          <button class="btn btn-primary btn-lg" id="opt-btn" onclick="Daily.runOptimizer()">
            Generar rutas optimizadas
          </button>
        </div>
        <div id="opt-progress" style="display:none;margin-top:1rem;width:100%;max-width:380px;"></div>
        <div id="opt-error" style="margin-top:1rem;max-width:420px;text-align:center;"></div>
        <div style="margin-top:1.25rem;">
          <button class="btn" onclick="Daily.step=2; Daily.render()">&#8592; Volver</button>
        </div>
      </div>
    `;
  },

  async runOptimizer() {
    const btn   = document.getElementById('opt-btn');
    const errEl = document.getElementById('opt-error');
    const prog  = document.getElementById('opt-progress');
    btn.disabled = true;
    btn.textContent = 'Calculando...';
    errEl.innerHTML = '';
    if (prog) prog.style.display = 'block';

    const hasKey = !!Storage.getApiKey();
    if (prog) prog.innerHTML = hasKey
      ? '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:#1e40af;">&#128506; <strong>Usando ORS Matrix API</strong> &mdash; tiempos reales por carretera</div><div class="progress-bar"><div class="progress-fill" id="opt-fill"></div></div><p id="opt-status" style="font-size:12px;color:var(--text3);margin-top:6px;"></p>'
      : '<div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:10px 14px;font-size:12px;color:#854d0e;">&#9888; <strong>Sin API Key ORS</strong> &mdash; tiempos estimados (inexactos en hora pico).<br>Configurala en <strong>Configuraci&oacute;n &rarr; API Key ORS</strong> para tiempos reales.</div>';

    try {
      const result = await Optimizer.optimize(this.session, (done, total, name) => {
        const fill   = document.getElementById('opt-fill');
        const status = document.getElementById('opt-status');
        if (fill)   fill.style.width = (total > 0 ? Math.round(done/total*100) : 0) + '%';
        if (status) status.textContent = name + '... (' + done + '/' + total + ')';
      });
      this.session.results    = result.routes;
      this.session.unassigned = result.unassigned;
      this.save();
      this.step = 4;
      this.render();
    } catch(e) {
      if (prog) prog.style.display = 'none';
      errEl.innerHTML = '<p class="test-error">Error: ' + e.message + '</p>';
      btn.disabled = false;
      btn.textContent = 'Reintentar';
    }
  },

  // ── PASO 4: Revisar y ajustar ─────────────────────────────────────────────
  renderStep4() {
    const drivers  = Storage.getDrivers();
    const vehicles = Storage.getVehicles();
    const stops    = Storage.getStops();
    const dMap     = Object.fromEntries(drivers.map(d  => [d.id, d]));
    const vMap     = Object.fromEntries(vehicles.map(v => [v.id, v]));
    const sMap     = Object.fromEntries(stops.map(s    => [s.id, s]));
    const routes   = this.session.results || [];
    const unassign = this.session.unassigned || [];
    const typeClr  = { SUCURSAL:'badge-sucursal', LOCKER:'badge-locker', TRANSPORTADORA:'badge-trans' };

    const unassignHtml = unassign.length ? `
      <div class="unassigned-panel">
        <div class="unassigned-title">&#9888; ${unassign.length} parada(s) sin asignar</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:.5rem;">
          ${unassign.map(u => { const s=sMap[u.stopId]; return s?'<span class="unassigned-chip">'+esc(s.name)+'</span>':''; }).join('')}
        </div>
      </div>` : '';

    const legendHtml = `
      <div style="background:#f5f5f5;padding:1rem;border-radius:6px;margin-bottom:1rem;font-size:12px;border-left:4px solid #3b82f6;">
        <strong style="display:block;margin-bottom:0.5rem;">📊 Cómo se calcula el tiempo:</strong>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.75rem;">
          <div>⏱️ <strong>Viaje</strong>: Distancia entre puntos (velocidad ciudad ${Optimizer.SPEED.city} km/h, interior ${Optimizer.SPEED.highway} km/h — solo aplica sin API Key ORS)</div>
          <div>🚐 <strong>Estacionar</strong>: 3 min fijo por parada</div>
          <div>📦 <strong>Bajar paquetes</strong>: 2 min fijo + 2 min por paquete</div>
          <div style="grid-column: 1/-1;color:#666;font-style:italic;">Ejemplo: 5 paquetes = 3 + 2 + (5×2) = 15 minutos de servicio</div>
        </div>
      </div>`;
    
    // Diagnóstico: detectar anomalías de distancia
    const anomalies = [];
    routes.forEach((route, ri) => {
      const depot = stops.find(s => s.type === 'DEPOT');
      if (!depot || route.isCarrier) return;
      route.steps.forEach(step => {
        if (step.type !== 'job' || !step.travelTime) return;
        const stop = sMap[step.stopId];
        if (!stop) return;
        // Si travelTime > 3600s (60 min) pero distancia es muy corta, hay un problema
        // O si distancia implica > 100 km pero tiempo es < 30 min en ciudad
        const travelMins = step.travelTime / 60;
        // Estimación con la misma velocidad de ciudad que usa el optimizador (ver Optimizer.SPEED)
        const estimatedKm = (travelMins * Optimizer.SPEED.city / 60);
        // Si se ve irreal (muy lento), anotar
        if (travelMins > 120 && estimatedKm < 100) {
          anomalies.push(`⚠️ ${esc(stop.name)}: ${travelMins.toFixed(0)} min parece alto, verificá coords`);
        }
      });
    });
    
    const anomalyHtml = anomalies.length > 0 ? `
      <div style="background:#fef3c7;padding:1rem;border-radius:6px;margin-bottom:1rem;border-left:4px solid #f59e0b;">
        <strong style="color:#92400e;display:block;margin-bottom:0.5rem;">⚠️ Anomalías detectadas:</strong>
        <div style="font-size:12px;color:#92400e;">
          ${anomalies.map(a => '<div>' + a + '</div>').join('')}
        </div>
      </div>` : '';

    const routeCards = routes.map((route, ri) => {
      let headerHtml, footerBtns;

      if (route.isCarrier) {
        headerHtml = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="driver-avatar" style="background:#fef3c7;color:#92400e;font-size:18px;">T</div>
            <div>
              <div style="font-weight:600;font-size:15px;">${esc(route.carrierName)}</div>
              <div style="font-size:12px;color:var(--text2);">Transportadora externa</div>
            </div>
          </div>`;
        footerBtns = `<button class="btn btn-sm btn-primary" onclick="Printer.printDriver(${ri})">Imprimir</button>`;
      } else {
        const asgn  = this.session.assignments[route.vehicleIdx];
        if (!asgn) return '';
        const driver = dMap[asgn.driverId];
        const veh    = vMap[asgn.vehicleId];
        const endLbl = asgn.endsAtHome ? 'Casa' : 'CDD';
        const jobs   = route.steps.filter(s => s.type === 'job');
        headerHtml = `
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="driver-avatar">${driver?.name.charAt(0)||'?'}</div>
            <div>
              <div style="font-weight:600;font-size:15px;">${esc(driver?.name||'?')}</div>
              <div style="font-size:12px;color:var(--text2);">
                ${esc(veh?.name||'?')} &middot; Sale ${asgn.departureTime} &middot; Regresa a ${endLbl}
              </div>
            </div>
          </div>`;
        footerBtns = `
          <div class="route-stat"><strong>${jobs.length}</strong><span>paradas</span></div>
          <div class="route-stat"><strong>${(route.distance/1000).toFixed(0)} km</strong><span>distancia</span></div>
          <div class="route-stat"><strong>${fmtDuration(route.duration)}</strong><span>duracion</span></div>
          <button class="btn btn-sm" onclick="Daily.openMaps(${ri})">Maps</button>
          <button class="btn btn-sm btn-primary" onclick="Printer.printDriver(${ri})">Imprimir</button>`;
      }

      const jobs = route.steps.filter(s => s.type === 'job');
      const isHistory = this._viewingHistory;
      let jobIdx = 0;
      const stopsHtml = route.steps.filter(s => s.type === 'job' || s.type === 'break').map((step, rawIdx) => {
        if (step.type === 'break') {
          return '<div style="padding:8px 16px;background:#fff8ee;border-bottom:1px solid var(--color-border-tertiary,#e4e4e7);display:flex;align-items:center;gap:8px;">'
            + '<span style="font-size:15px;">&#9646;&#9646;</span>'
            + '<span style="font-size:12px;font-weight:500;color:#92400e;">Pausa obligatoria &mdash; 30 minutos</span>'
            + '<span style="font-size:11px;color:#b45309;margin-left:auto;">' + secsToTime(step.arrival) + '</span>'
            + '</div>';
        }
        const si  = jobIdx++;
        const stop = sMap[step.stopId];
        if (!stop) return '';
        const qty = this.session.packages[stop.id] || 0;
        return '<div class="route-stop"' + (isHistory ? '' : ' draggable="true"'
          + ' ondragstart="Daily.ds(' + ri + ',' + si + ')"'
          + ' ondragover="Daily.dov(event,' + ri + ',' + si + ')"'
          + ' ondrop="Daily.dp(event,' + ri + ',' + si + ')"'
          + ' ondragend="Daily.de()"')
          + ' id="rs-' + ri + '-' + si + '">'
          + '<div class="rs-num">' + (si+1) + '</div>'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(stop.name) + '</div>'
          + '<div style="font-size:11px;color:var(--text3);">' + esc(stop.city) + ' &middot; ' + qty + ' paquete' + (qty!==1?'s':'') + '</div>'
          + '<div style="font-size:10px;color:#666;margin-top:2px;">'
            + (step.travelTime ? 'Viaje: ' + Math.round(step.travelTime/60) + ' min' : '')
            + (step.service ? (step.travelTime ? ' • ' : '') + 'Servicio: ' + Math.round(step.service/60) + ' min' : '')
          + '</div>'
          + '</div>'
          + '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">'
          + (step.arrival ? '<span style="font-size:12px;color:var(--text2);">' + secsToTime(step.arrival) + (step.arrival>=86400 ? ' <span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px;border:1px solid #fde68a;">+1</span>' : '') + '</span>' : '')
          + (stop.mapsUrl ? '<a href="' + esc(stop.mapsUrl) + '" target="_blank" class="maps-lnk">mapa</a>' : '')
          + '<span class="badge ' + (typeClr[stop.type]||'') + '">' + stop.type + '</span>'
          + (isHistory ? '' : '<button class="rm-stop-btn" onclick="Daily.removeStop(' + ri + ',' + si + ')" title="Quitar">&#215;</button>')
          + '</div>'
          + '</div>';
      }).join('');

      return '<div class="route-card">'
        + '<div class="route-card-hdr">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;width:100%;flex-wrap:wrap;gap:8px;">'
        + headerHtml
        + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' + footerBtns + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="route-stops-list">' + stopsHtml + '</div>'
        + '</div>';
    }).join('');

    const navBtns = this._viewingHistory
      ? `<button class="btn" onclick="Daily.exitHistoryView()">&#8592; Volver al día de hoy</button>`
      : `<button class="btn" onclick="Daily.step=2; Daily.render()">&#8592; Volver</button>
         <button class="btn" onclick="Daily.step=3; Daily.render()">Reoptimizar</button>`;

    document.getElementById('step-content').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;gap:8px;flex-wrap:wrap;">
        <p style="color:var(--text2);font-size:13px;">${this._viewingHistory ? 'Vista de solo lectura.' : 'Podés arrastrar paradas para reordenarlas.'}</p>
        <div style="display:flex;gap:8px;">
          ${navBtns}
          <button class="btn" onclick="Daily.showRouteMap()">🗺️ Ver mapa</button>
          <button class="btn btn-primary" onclick="Printer.printAll()">Imprimir todo</button>
        </div>
      </div>
      ${unassignHtml}
      ${anomalyHtml}
      ${legendHtml}
      <div style="display:flex;flex-direction:column;gap:1rem;">${routeCards}</div>
    `;
  },

  removeStop(ri, si) {
    const route = this.session.results?.[ri];
    if (!route) return;
    let jobCount = 0;
    route.steps = route.steps.filter(s => { if (s.type!=='job') return true; return jobCount++ !== si; });
    this.save(); this.renderStep4();
  },

  openMaps(ri) {
    const stops  = Storage.getStops();
    const depot  = stops.find(s => s.type === 'DEPOT');
    const route  = this.session.results?.[ri];
    if (!route) return;
    const asgn   = this.session.assignments[route.vehicleIdx];
    const driver = Storage.getDrivers().find(d => d.id === asgn?.driverId);
    const jobs   = route.steps.filter(s => s.type === 'job');
    const sMap   = Object.fromEntries(stops.map(s => [s.id, s]));
    const wpts   = jobs.map(s => sMap[s.stopId]).filter(s => s?.lat).map(s => s.lat+','+s.lng);
    if (!wpts.length) { alert('Las paradas no tienen coordenadas.'); return; }
    const origin = depot?.lat ? depot.lat+','+depot.lng : '';
    const dest   = asgn?.endsAtHome && driver?.homeLat ? driver.homeLat+','+driver.homeLng : origin;
    let url = 'https://www.google.com/maps/dir/?api=1';
    if (origin) url += '&origin=' + origin;
    url += '&destination=' + (wpts.length>1 ? wpts[wpts.length-1] : dest);
    if (wpts.length > 1) url += '&waypoints=' + wpts.slice(0,-1).slice(0,9).join('|');
    url += '&travelmode=driving';
    window.open(url, '_blank');
  },

  // ── Mapa embebido (todas las rutas del día, una encima de otra) ────────────
  ROUTE_COLORS: ['#2563eb','#dc2626','#16a34a','#d97706','#7c3aed','#0891b2','#db2777','#65a30d','#ea580c','#4f46e5'],

  showRouteMap() {
    const routes = this.session.results || [];
    if (!routes.length) { alert('Todavía no hay rutas generadas.'); return; }

    const legendItems = routes.map((route, ri) => {
      const color = this.ROUTE_COLORS[ri % this.ROUTE_COLORS.length];
      const label = route.isCarrier
        ? (route.carrierName || 'Transportadora')
        : (Storage.getDrivers().find(d => d.id === this.session.assignments[route.vehicleIdx]?.driverId)?.name || 'Chofer');
      return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
        <input type="checkbox" checked data-route-idx="${ri}" onchange="Daily._toggleMapRoute(${ri}, this.checked)">
        <span style="width:12px;height:12px;border-radius:50%;background:${color};display:inline-block;"></span>
        ${esc(label)}
      </label>`;
    }).join('');

    App.showModal(`
      <div class="modal-header"><h2>Mapa de rutas del día</h2></div>
      <div class="modal-body" style="padding:0;">
        <div style="display:flex;flex-wrap:wrap;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border2,#e5e5e5);">
          ${legendItems}
        </div>
        <div id="route-map" style="height:65vh;width:100%;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="App.closeModal()">Cerrar</button>
      </div>
    `);
    setTimeout(() => this._initRouteMap(), 60);
  },

  _initRouteMap() {
    const el = document.getElementById('route-map');
    if (!el || typeof L === 'undefined') return;

    const stops = Storage.getStops();
    const sMap  = Object.fromEntries(stops.map(s => [s.id, s]));
    const depot = stops.find(s => s.type === 'DEPOT');
    const routes = this.session.results || [];

    const map = L.map(el);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    this._mapLayers = {};

    const allPoints = [];
    if (depot?.lat) {
      L.marker([depot.lat, depot.lng], { title: 'CDD — ' + depot.name })
        .addTo(map).bindPopup('<strong>' + esc(depot.name) + '</strong><br>Depósito');
      allPoints.push([depot.lat, depot.lng]);
    }

    routes.forEach((route, ri) => {
      const color = this.ROUTE_COLORS[ri % this.ROUTE_COLORS.length];
      const layerGroup = L.layerGroup().addTo(map);
      this._mapLayers[ri] = layerGroup;

      const jobs = route.steps.filter(s => s.type === 'job');
      const jobPoints = jobs.map(s => sMap[s.stopId]).filter(s => s?.lat);

      if (route.geometry) {
        const coords = decodePolyline(route.geometry);
        if (coords.length) {
          L.polyline(coords, { color, weight: 4, opacity: 0.75 }).addTo(layerGroup);
          coords.forEach(c => allPoints.push(c));
        }
      } else if (jobPoints.length) {
        // Sin trazado real del motor (se usó el estimador de respaldo) — línea recta entre paradas
        const straight = [depot?.lat ? [depot.lat, depot.lng] : null, ...jobPoints.map(s => [s.lat, s.lng])].filter(Boolean);
        L.polyline(straight, { color, weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(layerGroup);
      }

      jobPoints.forEach((s, si) => {
        const num  = si + 1;
        const icon = L.divIcon({
          className: '',
          html: '<div style="background:' + color + ';color:#fff;width:24px;height:24px;border-radius:50%;'
            + 'border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;'
            + 'justify-content:center;font-size:11px;font-weight:700;font-family:sans-serif;">' + num + '</div>',
          iconSize: [24, 24], iconAnchor: [12, 12],
        });
        L.marker([s.lat, s.lng], { icon }).addTo(layerGroup).bindPopup(
          '<strong>' + num + '. ' + esc(s.name) + '</strong><br>' + esc(s.city || '')
        );
        allPoints.push([s.lat, s.lng]);
      });
    });

    if (allPoints.length) map.fitBounds(allPoints, { padding: [30, 30] });
    else map.setView([-25.2637, -57.5759], 12); // Asunción, por si no hay coordenadas

    this._map = map;
  },

  _toggleMapRoute(ri, visible) {
    const layer = this._mapLayers?.[ri];
    if (!layer || !this._map) return;
    if (visible) layer.addTo(this._map); else this._map.removeLayer(layer);
  },

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  ds(ri, si) {
    this.dragRI = ri; this.dragSI = si;
    setTimeout(() => document.getElementById('rs-'+ri+'-'+si)?.classList.add('dragging'), 0);
  },
  de() {
    document.querySelectorAll('.route-stop').forEach(el => {
      el.classList.remove('dragging'); el.classList.remove('drop-over');
    });
  },
  dov(e, ri, si) {
    e.preventDefault();
    document.querySelectorAll('.route-stop').forEach(el => el.classList.remove('drop-over'));
    if (this.dragRI !== null && !(this.dragRI===ri && this.dragSI===si))
      document.getElementById('rs-'+ri+'-'+si)?.classList.add('drop-over');
  },
  dp(e, ri, si) {
    e.preventDefault();
    if (this.dragRI===null || (this.dragRI===ri && this.dragSI===si)) { this.de(); return; }
    const fromRoute = this.session.results[this.dragRI];
    const toRoute   = this.session.results[ri];
    const fromJobs  = fromRoute.steps.filter(s => s.type==='job');
    const toJobs    = ri===this.dragRI ? fromJobs : toRoute.steps.filter(s => s.type==='job');
    const [moved]   = fromJobs.splice(this.dragSI, 1);
    toJobs.splice(si, 0, moved);
    const rebuild = (route, jobs) => {
      const start = route.steps.find(s => s.type==='start');
      const end   = route.steps.find(s => s.type==='end');
      route.steps = [start, ...jobs, end].filter(Boolean);
    };
    if (ri===this.dragRI) { rebuild(fromRoute, fromJobs); }
    else { rebuild(fromRoute, fromJobs); rebuild(toRoute, toJobs); }
    this.dragRI = null; this.dragSI = null;
    this.save(); this.renderStep4();
  },
};
