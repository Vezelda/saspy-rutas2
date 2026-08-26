// utils.js — Helpers compartidos

function secsToTime(secs, showDay) {
  if (secs == null || secs === undefined) return '—';
  const next = secs >= 86400;
  const s = secs % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const str = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  return (next && showDay !== false) ? str + ' (+1)' : str;
}

function timeToSecs(str) {
  if (!str) return 0;
  const clean = str.toString().replace(/[apm\s.]/gi,'').trim();
  const [h, m] = clean.split(':').map(Number);
  return (h||0)*3600 + (m||0)*60;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str+'T12:00').toLocaleDateString('es-PY',{
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  });
}

function fmtDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? h + 'h' + (m > 0 ? m + 'm' : '') : m + 'min';
}

// Decodifica el polyline codificado que devuelve VROOM/OSRM (precisión 5) a [[lat,lng], ...]
function decodePolyline(str) {
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < str.length) {
    let shift = 0, result = 0, byte;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}
