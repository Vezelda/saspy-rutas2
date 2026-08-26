// printer.js — Genera hoja de ruta imprimible por chofer

const Printer = {

  printAll() {
    const session = Daily?.session;
    if (!session?.results?.length) { showToast('No hay rutas generadas para imprimir.', 'warning'); return; }
    session.results.forEach((_, ri) => this.printDriver(ri));
  },

  printDriver(ri) {
    const session  = Daily?.session;
    if (!session?.results?.[ri]) return;

    const stops    = Storage.getStops();
    const drivers  = Storage.getDrivers();
    const vehicles = Storage.getVehicles();
    const sMap     = Object.fromEntries(stops.map(s => [s.id, s]));
    const dMap     = Object.fromEntries(drivers.map(d => [d.id, d]));
    const vMap     = Object.fromEntries(vehicles.map(v => [v.id, v]));

    const route  = session.results[ri];
    const asgn   = session.assignments[route.vehicleIdx];
    const driver = dMap[asgn?.driverId];
    const vehicle= vMap[asgn?.vehicleId];

    const jobSteps = (route.steps||[]).filter(s => s.type === 'job');
    const totalMin = Math.round(route.duration / 60);
    const totalKm  = (route.distance / 1000).toFixed(0);
    const endLabel = asgn?.endsAtHome ? 'Casa del chofer' : 'CDD';
    const fecha    = fmtDate(session.date);

    // Generar filas de la tabla
    let rows = '';
    jobSteps.forEach((step, i) => {
      const stop = sMap[step.stopId];
      if (!stop) return;
      const qty     = session.packages[stop.id] || 0;
      const arrival = secsToTime(step.arrival, false); // raw time, +1 shown separately

      const typeStyle = {
        LOCKER:        'background:#dbeafe;color:#1e40af',
        SUCURSAL:      'background:#ede9fe;color:#4c1d95',
        TRANSPORTADORA:'background:#fef3c7;color:#92400e',
      }[stop.type] || '';

      // Pausa cada 6 paradas (~4h conducción estimada)
      if (i > 0 && i % 6 === 0) {
        rows += `<tr style="background:#fffbeb;">
          <td colspan="7" style="padding:5px 12px;font-size:11px;color:#92400e;font-style:italic;">
            ⏸ Pausa obligatoria de 30 minutos — cada 4 horas de conducción
          </td>
        </tr>`;
      }

      rows += `
        <tr style="border-bottom:0.5px solid #e5e5e5;">
          <td style="padding:7px 12px;font-weight:600;color:#666;text-align:center;">${i+1}</td>
          <td style="padding:7px 12px;font-size:12px;">${esc(stop.name)}</td>
          <td style="padding:7px 12px;font-size:11px;color:#777;">${esc(stop.city)}</td>
          <td style="padding:7px 12px;font-size:12px;text-align:center;font-weight:600;">${qty}</td>
          <td style="padding:7px 12px;font-size:11px;color:#777;white-space:nowrap;">
            ${stop.opens||'00:00'} – ${stop.closes||'24:00'}
          </td>
          <td style="padding:7px 12px;font-size:12px;color:#333;font-weight:500;white-space:nowrap;">
            ${arrival}
          </td>
          <td style="padding:7px 12px;">
            <span style="font-size:10px;padding:2px 6px;border-radius:3px;font-weight:500;${typeStyle}">
              ${stop.type}
            </span>
          </td>
        </tr>
        <tr style="border-bottom:1px solid #e5e5e5;background:#fafafa;">
          <td></td>
          <td colspan="6" style="padding:4px 12px;font-size:10px;color:#aaa;">
            ${stop.mapsUrl
              ? `<a href="${esc(stop.mapsUrl)}" style="color:#2563eb;">📍 Ver en Google Maps</a>`
              : esc(stop.address || '')}
            ${stop.notes ? ` · ${esc(stop.notes)}` : ''}
          </td>
        </tr>`;
    });

    // Aviso de descanso largo si hay ruta de interior
    const deptsInterior = jobSteps
      .map(s => sMap[s.stopId]?.dept)
      .filter(d => d && !['Asunción','Central'].includes(d));
    const restNote = deptsInterior.length > 0 ? `
      <tr style="background:#f0fdf4;">
        <td colspan="7" style="padding:7px 12px;font-size:11px;color:#166534;font-style:italic;">
          🛑 Descanso largo de 60 minutos obligatorio en punto autorizado antes del regreso
        </td>
      </tr>` : '';

    // Google Maps URL con las primeras 9 paradas (límite de URL)
    const depot = stops.find(s => s.type === 'DEPOT');
    const waypts = jobSteps
      .map(s => sMap[s.stopId])
      .filter(s => s?.lat)
      .map(s => `${s.lat},${s.lng}`);

    let mapsUrl = '';
    if (depot?.lat && waypts.length) {
      const origin = `${depot.lat},${depot.lng}`;
      const dest   = asgn?.endsAtHome && driver?.homeLat
        ? `${driver.homeLat},${driver.homeLng}`
        : origin;
      const wps = waypts.slice(0, 9).join('|');
      mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&waypoints=${wps}&travelmode=driving`;
    }

    const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="utf-8">
<title>Hoja de ruta — ${esc(driver?.name||'Chofer')}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; color: #111; padding: 12mm 10mm; font-size: 12px; }
  .hdr { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-start; }
  h1   { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  .meta { display: flex; gap: 16px; flex-wrap: wrap; }
  .mi  { font-size: 11px; color: #666; }
  .mi strong { color: #111; display: block; font-size: 13px; margin-bottom: 1px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th    { text-align: left; padding: 6px 12px; font-size: 10px; color: #888; border-bottom: 1px solid #ddd; text-transform: uppercase; letter-spacing: .3px; }
  .maps-link { font-size: 11px; margin-top: 12px; color: #2563eb; }
  .sig-row { display: flex; gap: 30px; margin-top: 20px; }
  .sig-box { flex: 1; border-top: 1px solid #999; padding-top: 5px; font-size: 10px; color: #888; }
  .footer  { margin-top: 14px; font-size: 10px; color: #bbb; text-align: center; }
  @media print { body { padding: 8mm; } @page { margin: 8mm; } }
</style></head>
<body>
<div class="hdr">
  <div>
    <h1>Hoja de ruta — ${esc(driver?.name || '?')}</h1>
    <div class="meta">
      <div class="mi"><strong>${esc(vehicle?.name||'?')}</strong>Vehículo</div>
      <div class="mi"><strong>${fecha}</strong>Fecha</div>
      <div class="mi"><strong>${asgn?.departureTime||'?'} hs</strong>Salida</div>
      <div class="mi"><strong>${endLabel}</strong>Regreso a</div>
      <div class="mi"><strong>${jobSteps.length} paradas</strong>Total</div>
      <div class="mi"><strong>~${totalKm} km · ${fmtDuration(route.duration)}</strong>Estimado</div>
    </div>
  </div>
  <div style="text-align:right;font-size:11px;color:#999;">
    Saspy Express<br>Logística móvil
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:32px;">#</th>
      <th>Punto de entrega</th>
      <th>Ciudad</th>
      <th style="text-align:center;">Paq.</th>
      <th>Horario</th>
      <th>Llegada est.</th>
      <th>Tipo</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    ${restNote}
  </tbody>
</table>

${mapsUrl ? `<p class="maps-link">📍 <a href="${mapsUrl}">Abrir ruta en Google Maps</a>${waypts.length > 9 ? ' (primeras 9 paradas por límite de URL)' : ''}</p>` : ''}

<div class="sig-row">
  <div class="sig-box">Firma del chofer</div>
  <div class="sig-box">Responsable CDD</div>
  <div class="sig-box">Observaciones</div>
</div>

<div class="footer">
  Saspy Express · Generado el ${new Date().toLocaleString('es-PY')}
</div>

<script>window.onload = () => window.print();<\/script>
</body></html>`;

    const w = window.open('', '_blank');
    if (!w) { showToast('Habilitá las ventanas emergentes para imprimir.', 'error'); return; }
    w.document.write(html);
    w.document.close();
  },
};
