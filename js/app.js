// app.js — Lógica principal y módulo de configuración

// ── Estado global de la UI ─────────────────────────────────────────────────
const App = {
  currentModule: 'config',
  currentTab: 'stops',      // stops | drivers | vehicles | apikey
  stopFilter: '',
  stopSearch: '',
  stopTypeFilter: 'ALL',
  editingId: null,

  init() {
    Storage.init();
    this.renderNav();
    this.loadModule('config');
  },

  // ── Navegación ───────────────────────────────────────────────────────────
  renderNav() {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        const mod = el.dataset.module;
        if (el.classList.contains('disabled')) return;
        this.loadModule(mod);
      });
    });
  },

  loadModule(name) {
    this.currentModule = name;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.module === name);
    });
    if (name === 'config') this.renderConfig();
    if (name === 'daily')  Daily.init();
  },

  // ── Backup: exportar / importar ──────────────────────────────────────────
  exportData() {
    const data = Storage.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `saspy-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  triggerImport() {
    document.getElementById('import-file-input')?.click();
  },

  async importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!(await showConfirm('Importar reemplazará TODAS las paradas, choferes, vehículos y transportadoras actuales por las del archivo. ¿Continuar?', { danger: true, okLabel: 'Sí, importar y reemplazar' }))) {
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        Storage.importAll(JSON.parse(reader.result));
        showToast('✅ Datos importados correctamente.', 'success');
        this.renderConfig();
      } catch(e) {
        showToast('Error al importar: ' + e.message, 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.onerror = () => showToast('No se pudo leer el archivo.', 'error');
    reader.readAsText(file);
  },

  // ── Módulo Configuración ─────────────────────────────────────────────────
  renderConfig() {
    const main = document.getElementById('main');
    main.innerHTML = `
      <div class="module-header mh-row">
        <div>
          <h1>Configuración</h1>
          <p>Paradas, choferes y vehículos. Editá y geocodificá coordenadas.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn" onclick="App.exportData()" title="Descarga un archivo JSON con todas las paradas, choferes, vehículos y transportadoras">
            ⬇ Exportar backup
          </button>
          <button class="btn" onclick="App.triggerImport()" title="Restaura paradas, choferes, vehículos y transportadoras desde un backup JSON">
            ⬆ Importar backup
          </button>
          <input type="file" id="import-file-input" accept="application/json" style="display:none" onchange="App.importData(event)">
        </div>
      </div>
      <div class="tabs">
        <button class="tab ${this.currentTab==='stops'   ?'active':''}" onclick="App.switchTab('stops')">
          Paradas <span class="tab-count" id="tc-stops"></span>
        </button>
        <button class="tab ${this.currentTab==='drivers' ?'active':''}" onclick="App.switchTab('drivers')">
          Choferes <span class="tab-count" id="tc-drivers"></span>
        </button>
        <button class="tab ${this.currentTab==='vehicles'?'active':''}" onclick="App.switchTab('vehicles')">
          Vehículos <span class="tab-count" id="tc-vehicles"></span>
        </button>
        <button class="tab ${this.currentTab==='carriers'?'active':''}" onclick="App.switchTab('carriers')">
          Transportadoras <span class="tab-count" id="tc-carriers"></span>
        </button>
        <button class="tab ${this.currentTab==='apikey'  ?'active':''}" onclick="App.switchTab('apikey')">
          API Key ORS
        </button>
        <button class="tab ${this.currentTab==='vroom'  ?'active':''}" onclick="App.switchTab('vroom')">
          Motor de rutas
        </button>
      </div>
      <div id="tab-content"></div>
    `;
    this.renderTabContent();
    this.updateTabCounts();
  },

  switchTab(tab) {
    this.currentTab = tab;
    this.stopSearch = '';
    this.stopTypeFilter = 'ALL';
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.textContent.trim().startsWith(
        { stops:'Paradas', drivers:'Choferes', vehicles:'Vehículos', carriers:'Transportadoras', apikey:'API', vroom:'Motor' }[tab]
      ));
    });
    this.renderTabContent();
  },

  renderTabContent() {
    const el = document.getElementById('tab-content');
    if (!el) return;
    if (this.currentTab === 'stops')    el.innerHTML = this.buildStopsTab();
    if (this.currentTab === 'drivers')  el.innerHTML = this.buildDriversTab();
    if (this.currentTab === 'vehicles') el.innerHTML = this.buildVehiclesTab();
    if (this.currentTab === 'apikey')   el.innerHTML = this.buildApiKeyTab();
    if (this.currentTab === 'carriers') el.innerHTML = this.buildCarriersTab();
    if (this.currentTab === 'vroom')    el.innerHTML = this.buildVroomTab();
  },

  updateTabCounts() {
    const stops   = Storage.getStops();
    const drivers = Storage.getDrivers();
    const vehicles= Storage.getVehicles();
    const withCoords = stops.filter(s => s.lat !== null).length;
    const el1 = document.getElementById('tc-stops');
    const el2 = document.getElementById('tc-drivers');
    const el3 = document.getElementById('tc-vehicles');
    if (el1) el1.textContent = `${stops.length} (${withCoords} con coords)`;
    if (el2) el2.textContent = drivers.length;
    if (el3) el3.textContent = vehicles.length;
    const carriers= Storage.getCarriers();
    const el4 = document.getElementById('tc-carriers');
    if (el4) el4.textContent = carriers.length;
  },


  onStopSearch(val) {
    this.stopSearch = val;
    this._filterStops();
  },

  onStopTypeFilter(btn) {
    this.stopTypeFilter = btn.dataset.type;
    document.querySelectorAll('#type-filter-pills .pill').forEach(b =>
      b.classList.toggle('active', b.dataset.type === this.stopTypeFilter));
    this._filterStops();
  },

  _filterStops() {
    const tbody = document.getElementById('stops-tbody');
    if (!tbody) return;
    const stops = Storage.getStops();
    const q = (this.stopSearch || '').toLowerCase();
    const filtered = stops.filter(s => {
      const mQ = !q || s.name.toLowerCase().includes(q) ||
                 (s.city||'').toLowerCase().includes(q) ||
                 (s.dept||'').toLowerCase().includes(q);
      const mT = (this.stopTypeFilter || 'ALL') === 'ALL' || s.type === this.stopTypeFilter;
      return mQ && mT;
    });
    const clr = { DEPOT:'badge-depot', SUCURSAL:'badge-sucursal', LOCKER:'badge-locker', TRANSPORTADORA:'badge-trans' };
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Sin resultados</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(s =>
      '<tr>' +
      '<td class="td-name"><div class="stop-name">' + esc(s.name||'') + '</div>' +
        '<div class="stop-sub">' + esc(s.city||'') + ' · ' + esc(s.dept||'') + '</div></td>' +
      '<td><span class="badge ' + (clr[s.type]||'') + '">' + s.type + '</span></td>' +
      '<td class="td-hours">' + (s.opens||'00:00') + ' – ' + (s.closes||'24:00') + '</td>' +
      '<td class="td-coords">' + (s.lat !== null && s.lat !== undefined
        ? '<span class="coord-ok">✓ ' + Number(s.lat).toFixed(4) + ', ' + Number(s.lng).toFixed(4) + '</span>'
        : '<span class="coord-missing">Sin coordenadas</span>') + '</td>' +
      '<td class="td-actions">' +
        (s.lat === null && s.type !== 'DEPOT'
          ? '<button class="btn-sm btn-ghost" onclick="App.geocodeSingle(\'' + s.id + '\')">Geocodificar</button>' : '') +
        '<button class="btn-sm btn-ghost" onclick="App.openEditStop(\'' + s.id + '\')">Editar</button>' +
        (s.type !== 'DEPOT'
          ? '<button class="btn-sm btn-danger" onclick="App.deleteStop(\'' + s.id + '\')">Borrar</button>' : '') +
      '</td></tr>'
    ).join('');
  },

  // ── Tab: Paradas ─────────────────────────────────────────────────────────
  buildStopsTab() {
    const stops = Storage.getStops();
    const vehicles = Storage.getVehicles();
    const noCoords = stops.filter(s => s.lat === null && s.type !== 'DEPOT').length;

    const filtered = stops.filter(s => {
      const q = this.stopSearch.toLowerCase();
      const matchSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        s.dept.toLowerCase().includes(q);
      const matchType = this.stopTypeFilter === 'ALL' || s.type === this.stopTypeFilter;
      return matchSearch && matchType;
    });

    const typeColors = {
      DEPOT: 'badge-depot', SUCURSAL: 'badge-sucursal',
      LOCKER: 'badge-locker', TRANSPORTADORA: 'badge-trans'
    };

    const rows = filtered.map(s => `
      <tr>
        <td class="td-name">
          <div class="stop-name">${esc(s.name)}</div>
          <div class="stop-sub">${esc(s.city)} · ${esc(s.dept)}</div>
        </td>
        <td><span class="badge ${typeColors[s.type]||''}">${s.type}</span></td>
        <td class="td-hours">${s.opens||'00:00'} – ${s.closes||'24:00'}</td>
        <td class="td-coords">
          ${s.lat !== null
            ? `<span class="coord-ok">✓ ${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</span>`
            : `<span class="coord-missing">Sin coordenadas</span>`
          }
        </td>
        <td class="td-actions">
          ${s.lat === null && s.type !== 'DEPOT'
            ? `<button class="btn-sm btn-ghost" onclick="App.geocodeSingle('${s.id}')">Geocodificar</button>`
            : ''
          }
          <button class="btn-sm btn-ghost" onclick="App.openEditStop('${s.id}')">Editar</button>
          ${s.type !== 'DEPOT'
            ? `<button class="btn-sm btn-danger" onclick="App.deleteStop('${s.id}')">Borrar</button>`
            : ''
          }
        </td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <div class="toolbar-left">
          <input type="search" class="search-input" placeholder="Buscar parada, ciudad..." value="${this.stopSearch}"
            id="stops-search" oninput="App.onStopSearch(this.value)">
          <div class="filter-pills">
            ${['ALL','LOCKER','SUCURSAL','TRANSPORTADORA','DEPOT'].map(t => `
              <button class="pill ${this.stopTypeFilter===t?'active':''}"
                data-type="${t}" onclick="App.onStopTypeFilter(this)">
                ${t==='ALL'?'Todos':t}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="toolbar-right">
          ${noCoords > 0 ? `
            <div class="geocode-banner">
              <span>⚠ ${noCoords} paradas sin coordenadas</span>
              <button class="btn btn-primary" onclick="App.openGeocodeAll()">
                Geocodificar todas (${noCoords})
              </button>
            </div>
          ` : '<span class="all-coords">✓ Todas las paradas tienen coordenadas</span>'}
          <button class="btn" onclick="App.openAddStop()">+ Agregar parada</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Parada</th><th>Tipo</th><th>Horario</th><th>Coordenadas</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody id="stops-tbody">${rows || '<tr><td colspan="5" class="empty-row">Sin resultados</td></tr>'}</tbody>
        </table>
      </div>
      <div id="modal-container"></div>
    `;
  },

  // ── Tab: Choferes ─────────────────────────────────────────────────────────
  buildDriversTab() {
    const drivers  = Storage.getDrivers();
    const vehicles = Storage.getVehicles();
    const vMap = Object.fromEntries(vehicles.map(v => [v.id, v.name]));

    const rows = drivers.map(d => `
      <tr>
        <td class="td-name"><div class="stop-name">${esc(d.name)}</div></td>
        <td>${esc(vMap[d.defaultVehicle] || '—')}</td>
        <td>
          ${d.canEndAtHome
            ? `<span class="badge badge-locker">Sí</span>
               ${d.homeLat ? `<span class="coord-ok" style="font-size:11px;margin-left:4px;">✓ coords</span>`
                           : `<span class="coord-missing" style="font-size:11px;margin-left:4px;">sin coords</span>`}`
            : `<span style="font-size:12px;color:var(--text3);">No — CDD</span>`
          }
        </td>
        <td class="td-notes">${esc(d.notes || '—')}</td>
        <td class="td-actions">
          <button class="btn-sm btn-ghost" onclick="App.openEditDriver('${d.id}')">Editar</button>
          <button class="btn-sm btn-danger" onclick="App.deleteDriver('${d.id}')">Borrar</button>
        </td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <div class="toolbar-left"></div>
        <div class="toolbar-right">
          <button class="btn" onclick="App.openAddDriver()">+ Agregar chofer</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Chofer</th><th>Vehículo habitual</th><th>Termina en casa</th><th>Notas</th><th>Acciones</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="empty-row">Sin choferes</td></tr>'}</tbody>
        </table>
      </div>
      <div id="modal-container"></div>
    `;
  },

  // ── Tab: Vehículos ────────────────────────────────────────────────────────
  buildVehiclesTab() {
    const vehicles = Storage.getVehicles();

    const rows = vehicles.map(v => `
      <tr>
        <td class="td-name"><div class="stop-name">${esc(v.name)}</div></td>
        <td>${esc(v.type)}</td>
        <td>${esc(v.plate || '—')}</td>
        <td class="td-notes">${esc(v.notes || '—')}</td>
        <td class="td-actions">
          <button class="btn-sm btn-ghost" onclick="App.openEditVehicle('${v.id}')">Editar</button>
          <button class="btn-sm btn-danger" onclick="App.deleteVehicle('${v.id}')">Borrar</button>
        </td>
      </tr>
    `).join('');

    return `
      <div class="toolbar">
        <div class="toolbar-left"></div>
        <div class="toolbar-right">
          <button class="btn" onclick="App.openAddVehicle()">+ Agregar vehículo</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Patente</th><th>Notas</th><th>Acciones</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="empty-row">Sin vehículos</td></tr>'}</tbody>
        </table>
      </div>
      <div id="modal-container"></div>
    `;
  },


  buildCarriersTab() {
    const carriers = Storage.getCarriers();
    const rows = carriers.map(c => `
      <tr>
        <td class="td-name"><div class="stop-name">${esc(c.name)}</div></td>
        <td style="font-size:12px;color:var(--text2);">${esc(c.contact||'—')}</td>
        <td style="font-size:12px;color:var(--text2);">${esc(c.phone||'—')}</td>
        <td class="td-coords">
          ${c.lat !== null && c.lat !== undefined
            ? `<span class="coord-ok">✓ ${Number(c.lat).toFixed(4)}, ${Number(c.lng).toFixed(4)}</span>`
            : `<span class="coord-missing">Sin coords</span>`}
        </td>
        <td class="td-notes" style="max-width:160px;">${esc(c.notes||'—')}</td>
        <td class="td-actions">
          <button class="btn-sm btn-ghost" onclick="App.openEditCarrier('${c.id}')">Editar</button>
          <button class="btn-sm btn-danger" onclick="App.deleteCarrier('${c.id}')">Borrar</button>
        </td>
      </tr>`).join('');
    return `
      <div class="toolbar">
        <div class="toolbar-left"></div>
        <div class="toolbar-right">
          <button class="btn" onclick="App.openAddCarrier()">+ Agregar transportadora</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Nombre</th><th>Contacto</th><th>Teléfono</th><th>Coordenadas</th><th>Notas</th><th>Acciones</th></tr></thead>
          <tbody>${rows||'<tr><td colspan="6" class="empty-row">Sin transportadoras. Agregá una con el botón.</td></tr>'}</tbody>
        </table>
      </div>
      <div id="modal-container"></div>`;
  },

  openAddCarrier() { this._showCarrierModal({id:'',name:'',contact:'',phone:'',address:'',lat:null,lng:null,notes:''}); },
  openEditCarrier(id) { const c=Storage.getCarriers().find(x=>x.id===id); if(c) this._showCarrierModal(c); },

  _showCarrierModal(c) {
    this.showModal(`
      <div class="modal-header"><h2>${c.id?'Editar transportadora':'Nueva transportadora'}</h2></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>Nombre *</label>
            <input id="fc-name" type="text" value="${esc(c.name)}" placeholder="Ej: Transportes Rápidos SRL">
          </div>
          <div class="form-group">
            <label>Persona de contacto</label>
            <input id="fc-contact" type="text" value="${esc(c.contact||'')}">
          </div>
          <div class="form-group">
            <label>Teléfono</label>
            <input id="fc-phone" type="tel" value="${esc(c.phone||'')}">
          </div>
          <div class="form-group full">
            <label>Dirección (depósito o punto de encuentro)</label>
            <input id="fc-address" type="text" value="${esc(c.address||'')}" placeholder="Calle y número, ciudad">
          </div>
          <div class="form-group">
            <label>Latitud</label>
            <input id="fc-lat" type="number" step="0.000001" value="${c.lat??''}" placeholder="-25.286700">
          </div>
          <div class="form-group">
            <label>Longitud</label>
            <input id="fc-lng" type="number" step="0.000001" value="${c.lng??''}" placeholder="-57.647000">
          </div>
          <div class="form-group full">
            <label>Notas</label>
            <input id="fc-notes" type="text" value="${esc(c.notes||'')}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="App.saveCarrier('${c.id}')">
          ${c.id?'Guardar':'Agregar'}
        </button>
        <button class="btn" onclick="App.closeModal()">Cancelar</button>
      </div>`);
  },

  saveCarrier(existingId) {
    const name    = document.getElementById('fc-name')?.value?.trim();
    const contact = document.getElementById('fc-contact')?.value?.trim();
    const phone   = document.getElementById('fc-phone')?.value?.trim();
    const address = document.getElementById('fc-address')?.value?.trim();
    const latRaw  = document.getElementById('fc-lat')?.value;
    const lngRaw  = document.getElementById('fc-lng')?.value;
    const notes   = document.getElementById('fc-notes')?.value?.trim();
    if (!name) { showToast('El nombre es obligatorio.', 'error'); return; }
    const fields = { name, contact, phone, address, lat: latRaw?parseFloat(latRaw):null, lng: lngRaw?parseFloat(lngRaw):null, notes };
    if (existingId) Storage.updateCarrier(existingId, fields);
    else Storage.addCarrier({...fields, id:''});
    this.closeModal();
    this.renderTabContent();
    this.updateTabCounts();
  },

  async deleteCarrier(id) {
    const c = Storage.getCarriers().find(x=>x.id===id);
    if (!c || !(await showConfirm('¿Borrar la transportadora "'+c.name+'"?', { danger: true, okLabel: 'Borrar' }))) return;
    Storage.deleteCarrier(id);
    this.renderTabContent();
    this.updateTabCounts();
  },

  // ── Tab: API Key ──────────────────────────────────────────────────────────
  buildApiKeyTab() {
    const key = Storage.getApiKey();
    return `
      <div class="api-key-panel">
        <div class="api-card">
          <h2>Configuración de API — OpenRouteService</h2>
          <p>
            Esta clave se usa solo una vez para geocodificar las paradas (calcular latitud/longitud de cada dirección)
            y para construir la matriz de distancias entre puntos. Después todo corre local.
          </p>
          <ol class="steps">
            <li>Entrá a <a href="https://openrouteservice.org/dev/#/signup" target="_blank">openrouteservice.org</a> y creá una cuenta gratuita.</li>
            <li>En tu dashboard, copiá el token del plan <strong>Free</strong>.</li>
            <li>Pegalo acá abajo y guardá.</li>
          </ol>
          <div class="api-form">
            <label>Tu API Key de ORS</label>
            <div class="api-input-row">
              <input type="password" id="ors-key-input" value="${esc(key)}"
                placeholder="5b3ce3597851110001cf6248..." style="font-family:monospace;">
              <button class="btn" onclick="App.toggleKeyVisibility()">👁</button>
            </div>
            <div class="api-actions">
              <button class="btn btn-primary" onclick="App.saveApiKey()">Guardar clave</button>
              <button class="btn" onclick="App.testApiKey()">Probar conexión</button>
            </div>
            <div id="api-test-result"></div>
          </div>
          <div class="api-limits">
            <strong>Límites del plan gratuito:</strong>
            Geocodificación: 2.000 req/día · Optimización de rutas: 40 req/día · Matriz de distancias: 500 req/día
          </div>
        </div>
      </div>
    `;
  },

  // ── Acciones: API Key ─────────────────────────────────────────────────────
  toggleKeyVisibility() {
    const input = document.getElementById('ors-key-input');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  },

  saveApiKey() {
    const val = document.getElementById('ors-key-input')?.value?.trim();
    if (!val) return showToast('Ingresá una clave válida.', 'error');
    Storage.setApiKey(val);
    showToast('✅ Clave guardada correctamente.', 'success');
  },

  async testApiKey() {
    const key = Storage.getApiKey();
    const result = document.getElementById('api-test-result');
    if (!key) { result.innerHTML = '<p class="test-error">⚠ Primero guardá una clave.</p>'; return; }
    result.innerHTML = '<p class="test-loading">Probando conexión...</p>';
    try {
      const res = await fetch(`https://api.openrouteservice.org/geocode/search?api_key=${key}&text=Asuncion+Paraguay&size=1`);
      if (res.ok) {
        result.innerHTML = '<p class="test-ok">✅ Conexión exitosa. La clave funciona correctamente.</p>';
      } else {
        const err = await res.json().catch(()=>({}));
        result.innerHTML = `<p class="test-error">❌ Error: ${err.error?.message || res.status}</p>`;
      }
    } catch(e) {
      result.innerHTML = `<p class="test-error">❌ No se pudo conectar: ${e.message}</p>`;
    }
  },

  // ── Tab: Motor de rutas (VROOM auto-hospedado) ────────────────────────────
  buildVroomTab() {
    const cfg = Storage.getVroomConfig() || { url:'', user:'', pass:'' };
    return `
      <div class="api-key-panel">
        <div class="api-card">
          <h2>Motor de rutas propio</h2>
          <p>
            Si tenés un motor de optimización propio corriendo (VROOM), la app le manda ahí
            los choferes y paradas de cada ruta en vez de usar el calculador interno.
            Si no configurás nada acá, la app sigue funcionando igual que siempre con ORS/estimaciones locales.
          </p>
          <div class="api-form">
            <label>URL del motor</label>
            <input type="text" id="vroom-url-input" value="${esc(cfg.url||'')}"
              placeholder="https://190.104.135.8:8443" style="font-family:monospace;">
            <label style="margin-top:10px;">Usuario</label>
            <input type="text" id="vroom-user-input" value="${esc(cfg.user||'')}" placeholder="admin">
            <label style="margin-top:10px;">Contraseña</label>
            <div class="api-input-row">
              <input type="password" id="vroom-pass-input" value="${esc(cfg.pass||'')}" style="font-family:monospace;">
              <button class="btn" onclick="App.toggleVroomPassVisibility()">👁</button>
            </div>
            <div class="api-actions">
              <button class="btn btn-primary" onclick="App.saveVroomConfig()">Guardar</button>
              <button class="btn" onclick="App.testVroomConfig()">Probar conexión</button>
              <button class="btn btn-ghost" onclick="App.clearVroomConfig()">Quitar / usar calculador interno</button>
            </div>
            <div id="vroom-test-result"></div>
          </div>
        </div>
      </div>
    `;
  },

  toggleVroomPassVisibility() {
    const input = document.getElementById('vroom-pass-input');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  },

  saveVroomConfig() {
    const url  = document.getElementById('vroom-url-input')?.value?.trim();
    const user = document.getElementById('vroom-user-input')?.value?.trim();
    const pass = document.getElementById('vroom-pass-input')?.value || '';
    if (!url) return showToast('Ingresá la URL del motor.', 'error');
    Storage.setVroomConfig({ url, user, pass });
    showToast('✅ Configuración guardada.', 'success');
  },

  async clearVroomConfig() {
    if (!(await showConfirm('¿Dejar de usar el motor propio y volver al calculador interno?', { okLabel: 'Sí, quitar' }))) return;
    Storage.clearVroomConfig();
    this.renderTabContent();
  },

  async testVroomConfig() {
    const url  = document.getElementById('vroom-url-input')?.value?.trim();
    const user = document.getElementById('vroom-user-input')?.value?.trim();
    const pass = document.getElementById('vroom-pass-input')?.value || '';
    const result = document.getElementById('vroom-test-result');
    if (!url) { result.innerHTML = '<p class="test-error">⚠ Ingresá la URL primero.</p>'; return; }
    result.innerHTML = '<p class="test-loading">Probando conexión...</p>';
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (user) headers['Authorization'] = 'Basic ' + btoa(user + ':' + pass);
      const res = await fetch(url.replace(/\/+$/, '') + '/', {
        method: 'POST', headers,
        body: JSON.stringify({
          vehicles: [{ id:1, start:[-57.4686,-25.2796], end:[-57.4686,-25.2796] }],
          jobs: [{ id:1, location:[-57.5699,-25.2983] }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        result.innerHTML = data.code === 0
          ? '<p class="test-ok">✅ Conexión exitosa. El motor respondió correctamente.</p>'
          : `<p class="test-error">❌ El motor respondió con error: ${esc(data.error||'desconocido')}</p>`;
      } else {
        result.innerHTML = `<p class="test-error">❌ Error HTTP ${res.status} — revisá usuario/contraseña.</p>`;
      }
    } catch(e) {
      result.innerHTML = `<p class="test-error">❌ No se pudo conectar: ${e.message}</p>`;
    }
  },

  // ── Geocodificación ───────────────────────────────────────────────────────
  async geocodeSingle(stopId) {
    const key = Storage.getApiKey();
    if (!key) { showToast('Primero configurá tu API Key en la pestaña "API Key ORS".', 'warning'); return; }
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const coords = await Geocode.geocodeSingle(stopId, key);
      this.renderTabContent();
      this.updateTabCounts();
    } catch(e) {
      showToast(`Error al geocodificar: ${e.message}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Geocodificar';
    }
  },

  openGeocodeAll() {
    const key = Storage.getApiKey();
    if (!key) { showToast('Primero configurá tu API Key en la pestaña "API Key ORS".', 'warning'); return; }
    const stops = Storage.getStops();
    const pending = stops.filter(s => s.lat === null && s.type !== 'DEPOT').length;

    this.showModal(`
      <div class="modal-header"><h2>Geocodificar todas las paradas</h2></div>
      <div class="modal-body">
        <p>Se geocodificarán <strong>${pending} paradas</strong> sin coordenadas.</p>
        <p>Esto puede tardar ~${Math.ceil(pending * 1.2 / 60)} minutos. No cerrés esta ventana.</p>
        <div class="progress-wrap" id="geo-progress" style="display:none;">
          <div class="progress-bar"><div class="progress-fill" id="geo-fill"></div></div>
          <p id="geo-status">Iniciando...</p>
        </div>
        <div id="geo-errors"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="geo-start-btn" onclick="App.runGeocodeAll()">Iniciar geocodificación</button>
        <button class="btn" onclick="App.closeModal()">Cerrar</button>
      </div>
    `);
  },

  async runGeocodeAll() {
    const key = Storage.getApiKey();
    document.getElementById('geo-start-btn').disabled = true;
    document.getElementById('geo-progress').style.display = 'block';

    const result = await Geocode.geocodeAll(key, (done, total, name) => {
      const pct = total > 0 ? Math.round(done / total * 100) : 0;
      const fill = document.getElementById('geo-fill');
      const status = document.getElementById('geo-status');
      if (fill) fill.style.width = pct + '%';
      if (status) status.textContent = `${done}/${total} — ${name}`;
    });

    const errEl = document.getElementById('geo-errors');
    if (result.errors.length > 0 && errEl) {
      errEl.innerHTML = `
        <p class="test-error">⚠ ${result.errors.length} paradas no se pudieron geocodificar:</p>
        <ul>${result.errors.map(e => `<li>${esc(e.name)}: ${esc(e.error)}</li>`).join('')}</ul>
        <p>Podés editarlas manualmente y corregir la dirección.</p>
      `;
    }

    this.renderTabContent();
    this.updateTabCounts();
  },

  // ── Modales: Paradas ──────────────────────────────────────────────────────
  openAddStop() {
    this.editingId = null;
    this._showStopModal({
      id:'', name:'', address:'', city:'', dept:'', type:'LOCKER',
      opens:null, closes:null, lat:null, lng:null, mapsUrl:'', notes:''
    });
  },

  openEditStop(id) {
    this.editingId = id;
    const stop = Storage.getStops().find(s => s.id === id);
    if (!stop) return;
    this._showStopModal(stop);
  },

  _showStopModal(stop) {
    const isEdit = !!stop.id;
    const types = ['LOCKER','SUCURSAL','TRANSPORTADORA','DEPOT'];
    this.showModal(`
      <div class="modal-header">
        <h2>${isEdit ? 'Editar parada' : 'Nueva parada'}</h2>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>Nombre *</label>
            <input id="f-name" type="text" value="${esc(stop.name)}" placeholder="Ej: Superseis Villa Morra">
          </div>
          <div class="form-group full">
            <label>Dirección (para geocodificar)</label>
            <input id="f-address" type="text" value="${esc(stop.address)}" placeholder="Ej: Villa Morra, Asunción, Paraguay">
          </div>
          <div class="form-group">
            <label>Ciudad</label>
            <input id="f-city" type="text" value="${esc(stop.city)}">
          </div>
          <div class="form-group">
            <label>Departamento</label>
            <input id="f-dept" type="text" value="${esc(stop.dept)}">
          </div>
          <div class="form-group">
            <label>Tipo</label>
            <select id="f-type">
              ${types.map(t => `<option value="${t}" ${stop.type===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group full" id="carrier-link-group" style="display:${stop.type==='TRANSPORTADORA'?'flex':'none'};flex-direction:column;gap:4px;">
            <label>Transportadora vinculada (opcional)</label>
            <select id="f-carrier" onchange="App.onCarrierLink(this.value)">
              <option value="">Ninguna — coords manuales</option>
              ${Storage.getCarriers().map(c => `<option value="${c.id}" ${stop.linkedCarrierId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
            </select>
            <small>Al vincular se usan las coordenadas y horarios de la transportadora</small>
          </div>
          <div class="form-group">
            <label>Horario apertura</label>
            <input id="f-opens" type="time" value="${stop.opens||''}">
            <small>Dejá vacío = 24 horas</small>
          </div>
          <div class="form-group">
            <label>Horario cierre</label>
            <input id="f-closes" type="time" value="${stop.closes||''}">
          </div>
          <div class="form-group">
            <label>Latitud</label>
            <input id="f-lat" type="number" step="0.000001" value="${stop.lat??''}" placeholder="Ej: -25.286700">
          </div>
          <div class="form-group">
            <label>Longitud</label>
            <input id="f-lng" type="number" step="0.000001" value="${stop.lng??''}" placeholder="Ej: -57.647000">
          </div>
          <div class="form-group full">
            <label>Link Google Maps</label>
            <input id="f-maps" type="url" value="${esc(stop.mapsUrl)}" placeholder="https://maps.app.goo.gl/...">
          </div>
          <div class="form-group full">
            <label>Notas</label>
            <input id="f-notes" type="text" value="${esc(stop.notes)}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="App.saveStop('${stop.id}')">
          ${isEdit ? 'Guardar cambios' : 'Agregar parada'}
        </button>
        <button class="btn" onclick="App.closeModal()">Cancelar</button>
      </div>
    `);
  },

  onStopTypeChange(sel) {
    const g = document.getElementById('carrier-link-group');
    if (g) g.style.display = sel.value === 'TRANSPORTADORA' ? 'flex' : 'none';
  },

  onCarrierLink(carrierId) {
    if (!carrierId) return;
    const c = Storage.getCarriers().find(x => x.id === carrierId);
    if (!c) return;
    if (c.lat != null) {
      const latEl = document.getElementById('f-lat');
      const lngEl = document.getElementById('f-lng');
      if (latEl) latEl.value = c.lat;
      if (lngEl) lngEl.value = c.lng;
    }
    if (c.opensTime) {
      const op = document.getElementById('f-opens');
      const cl = document.getElementById('f-closes');
      if (op) op.value = c.opensTime || '';
      if (cl) cl.value = c.closesTime || '';
    }
  },

    saveStop(existingId) {
    const name    = document.getElementById('f-name')?.value?.trim();
    const address = document.getElementById('f-address')?.value?.trim();
    const city    = document.getElementById('f-city')?.value?.trim();
    const dept    = document.getElementById('f-dept')?.value?.trim();
    const type    = document.getElementById('f-type')?.value;
    const opensRaw= document.getElementById('f-opens')?.value;
    const closesRaw=document.getElementById('f-closes')?.value;
    const latRaw  = document.getElementById('f-lat')?.value;
    const lngRaw  = document.getElementById('f-lng')?.value;
    const mapsUrl     = document.getElementById('f-maps')?.value?.trim();
    const notes       = document.getElementById('f-notes')?.value?.trim();
    const linkedCId   = document.getElementById('f-carrier')?.value || '';

    if (!name) { showToast('El nombre es obligatorio.', 'error'); return; }

    const fields = {
      name, address, city, dept, type,
      opens:  opensRaw  || null,
      closes: closesRaw || null,
      lat:    latRaw  ? parseFloat(latRaw)  : null,
      lng:    lngRaw  ? parseFloat(lngRaw)  : null,
      mapsUrl, notes, linkedCarrierId: linkedCId
    };

    if (existingId) {
      Storage.updateStop(existingId, fields);
    } else {
      Storage.addStop({ ...fields, id: '' });
    }

    this.closeModal();
    this.renderTabContent();
    this.updateTabCounts();
  },

  async deleteStop(id) {
    const stop = Storage.getStops().find(s => s.id === id);
    if (!stop) return;
    if (!(await showConfirm(`¿Borrar "${stop.name}"? Esta acción no se puede deshacer.`, { danger: true, okLabel: 'Borrar' }))) return;
    Storage.deleteStop(id);
    this.renderTabContent();
    this.updateTabCounts();
  },

  // ── Modales: Choferes ─────────────────────────────────────────────────────
  openAddDriver() {
    this._showDriverModal({ id:'', name:'', defaultVehicle:'', notes:'' });
  },
  openEditDriver(id) {
    const d = Storage.getDrivers().find(d => d.id === id);
    if (d) this._showDriverModal(d);
  },
  _showDriverModal(d) {
    const vehicles = Storage.getVehicles();
    const hasHome = d.canEndAtHome || false;
    this.showModal(`
      <div class="modal-header"><h2>${d.id ? 'Editar chofer' : 'Nuevo chofer'}</h2></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>Nombre *</label>
            <input id="fd-name" type="text" value="${esc(d.name)}" placeholder="Ej: HERNAN">
          </div>
          <div class="form-group">
            <label>Vehículo habitual</label>
            <select id="fd-vehicle">
              <option value="">Sin asignar</option>
              ${vehicles.map(v => `<option value="${v.id}" ${d.defaultVehicle===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>¿Puede terminar en su casa?</label>
            <select id="fd-canhome" onchange="App.toggleHomeFields()">
              <option value="0" ${!hasHome?'selected':''}>No — siempre regresa al CDD</option>
              <option value="1" ${hasHome?'selected':''}>Sí — puede terminar en casa</option>
            </select>
          </div>
          <div id="home-fields" style="display:${hasHome?'contents':'none'}">
            <div class="form-group full">
              <label>Dirección de casa (para geocodificar)</label>
              <input id="fd-homeaddr" type="text" value="${esc(d.homeAddress||'')}"
                placeholder="Ej: Barrio San Pablo, Luque, Paraguay">
            </div>
            <div class="form-group">
              <label>Latitud casa</label>
              <input id="fd-homelat" type="number" step="0.000001" value="${d.homeLat??''}"
                placeholder="-25.286700">
            </div>
            <div class="form-group">
              <label>Longitud casa</label>
              <input id="fd-homelng" type="number" step="0.000001" value="${d.homeLng??''}"
                placeholder="-57.647000">
            </div>
            <div class="form-group" style="align-self:end;">
              <button class="btn" style="width:100%" onclick="App.geocodeDriverHome('${d.id}')">
                📍 Geocodificar dirección
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>Corredor de ruta</label>
            <select id="fd-corridor">
              <option value=""      ${!d.corridor           ?'selected':''}>Ciudad (sin corredor)</option>
              <option value="norte" ${d.corridor==='norte'  ?'selected':''}>Norte — Pedro Juan Caballero</option>
              <option value="este"  ${d.corridor==='este'   ?'selected':''}>Este — Ciudad del Este</option>
              <option value="sur"   ${d.corridor==='sur'    ?'selected':''}>Sur — Encarnación</option>
            </select>
          </div>
          <div class="form-group full">
            <label>Notas</label>
            <input id="fd-notes" type="text" value="${esc(d.notes)}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="App.saveDriver('${d.id}')">
          ${d.id ? 'Guardar' : 'Agregar'}
        </button>
        <button class="btn" onclick="App.closeModal()">Cancelar</button>
      </div>
    `);
  },

  toggleHomeFields() {
    const sel = document.getElementById('fd-canhome');
    const fields = document.getElementById('home-fields');
    if (!sel || !fields) return;
    fields.style.display = sel.value === '1' ? 'contents' : 'none';
  },

  async geocodeDriverHome(driverId) {
    const key = Storage.getApiKey();
    if (!key) { showToast('Primero configurá tu API Key en la pestaña "API Key ORS".', 'warning'); return; }
    const addr = document.getElementById('fd-homeaddr')?.value?.trim();
    if (!addr) { showToast('Ingresá la dirección de la casa primero.', 'error'); return; }
    const btn = event.target;
    btn.disabled = true; btn.textContent = '⏳ Geocodificando...';
    try {
      const coords = await Geocode.geocodeStop({ address: addr }, key);
      const latInput = document.getElementById('fd-homelat');
      const lngInput = document.getElementById('fd-homelng');
      if (latInput) latInput.value = coords.lat;
      if (lngInput) lngInput.value = coords.lng;
      btn.textContent = `✓ ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    } catch(e) {
      showToast(`Error: ${e.message}`, 'error');
      btn.disabled = false; btn.textContent = '📍 Geocodificar dirección';
    }
  },

  saveDriver(existingId) {
    const name      = document.getElementById('fd-name')?.value?.trim();
    const vehicle   = document.getElementById('fd-vehicle')?.value;
    const canHome   = document.getElementById('fd-canhome')?.value === '1';
    const homeAddr  = document.getElementById('fd-homeaddr')?.value?.trim() || '';
    const homeLat   = document.getElementById('fd-homelat')?.value;
    const homeLng   = document.getElementById('fd-homelng')?.value;
    const notes     = document.getElementById('fd-notes')?.value?.trim();
    const corridor   = document.getElementById('fd-corridor')?.value || null;
    if (!name) { showToast('El nombre es obligatorio.', 'error'); return; }
    const fields = {
      name, defaultVehicle: vehicle, notes,
      corridor: corridor || null,
      canEndAtHome: canHome,
      homeAddress:  canHome ? homeAddr : '',
      homeLat:      canHome && homeLat ? parseFloat(homeLat) : null,
      homeLng:      canHome && homeLng ? parseFloat(homeLng) : null,
    };
    if (existingId) Storage.updateDriver(existingId, fields);
    else Storage.addDriver({ ...fields, id: '' });
    this.closeModal();
    this.renderTabContent();
    this.updateTabCounts();
  },
  async deleteDriver(id) {
    const d = Storage.getDrivers().find(d => d.id === id);
    if (!d || !(await showConfirm(`¿Borrar al chofer "${d.name}"?`, { danger: true, okLabel: 'Borrar' }))) return;
    Storage.deleteDriver(id);
    this.renderTabContent();
    this.updateTabCounts();
  },

  // ── Modales: Vehículos ────────────────────────────────────────────────────
  openAddVehicle() {
    this._showVehicleModal({ id:'', name:'', type:'', plate:'', notes:'' });
  },
  openEditVehicle(id) {
    const v = Storage.getVehicles().find(v => v.id === id);
    if (v) this._showVehicleModal(v);
  },
  _showVehicleModal(v) {
    this.showModal(`
      <div class="modal-header"><h2>${v.id ? 'Editar vehículo' : 'Nuevo vehículo'}</h2></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group full">
            <label>Nombre *</label>
            <input id="fv-name" type="text" value="${esc(v.name)}" placeholder="Ej: Mercedes Atego">
          </div>
          <div class="form-group">
            <label>Tipo</label>
            <select id="fv-type">
              ${['MERCEDES','CANTER','SPRINTER','FUNCARGO'].map(t =>
                `<option value="${t}" ${v.type===t?'selected':''}>${t}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Patente</label>
            <input id="fv-plate" type="text" value="${esc(v.plate)}" placeholder="Ej: ABC-123">
          </div>
          <div class="form-group full">
            <label>Notas</label>
            <input id="fv-notes" type="text" value="${esc(v.notes)}">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="App.saveVehicle('${v.id}')">
          ${v.id ? 'Guardar' : 'Agregar'}
        </button>
        <button class="btn" onclick="App.closeModal()">Cancelar</button>
      </div>
    `);
  },
  saveVehicle(existingId) {
    const name  = document.getElementById('fv-name')?.value?.trim();
    const type  = document.getElementById('fv-type')?.value;
    const plate = document.getElementById('fv-plate')?.value?.trim();
    const notes = document.getElementById('fv-notes')?.value?.trim();
    if (!name) { showToast('El nombre es obligatorio.', 'error'); return; }
    const fields = { name, type, plate, notes };
    if (existingId) Storage.updateVehicle(existingId, fields);
    else Storage.addVehicle({ ...fields, id: '' });
    this.closeModal();
    this.renderTabContent();
    this.updateTabCounts();
  },
  async deleteVehicle(id) {
    const v = Storage.getVehicles().find(v => v.id === id);
    if (!v || !(await showConfirm(`¿Borrar el vehículo "${v.name}"?`, { danger: true, okLabel: 'Borrar' }))) return;
    Storage.deleteVehicle(id);
    this.renderTabContent();
    this.updateTabCounts();
  },

  // ── Utilidades de modal ───────────────────────────────────────────────────
  showModal(html) {
    // Buscar o crear overlay
    let overlay = document.getElementById('modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modal-overlay';
      overlay.className = 'modal-overlay';
      overlay.onclick = e => { if (e.target === overlay) this.closeModal(); };
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="modal">${html}</div>`;
    overlay.style.display = 'flex';
    // Focus primer input
    setTimeout(() => overlay.querySelector('input, select')?.focus(), 50);
  },

  closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }
};

// esc() vive en utils.js (cargado antes que este archivo)

// ── Arranque ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());