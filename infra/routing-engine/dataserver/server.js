// server.js — Backend chico de datos compartidos para Saspy Rutas.
// Cada "tabla" (paradas, choferes, etc.) es un archivo JSON en disco.
// Sin base de datos de verdad -- no hace falta para este volumen de uso.
// El CORS y la autenticación los pone nginx delante de esto (ver ../nginx/vroom.conf).

const express = require('express');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const PORT = process.env.PORT || 3001;

// Mismas claves que usaba storage.js en localStorage — una por "tabla".
const ALLOWED_KEYS = new Set([
  'stops', 'drivers', 'vehicles', 'carriers',
  'apiKey', 'settings', 'dailyHistory', 'dailySession',
]);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function keyPath(key) {
  return path.join(DATA_DIR, key + '.json');
}

// Escritura atómica: escribe a un archivo temporal y recién después lo renombra,
// así una caída a mitad de escritura nunca deja el archivo real corrupto.
function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}

const app = express();
app.use(express.json({ limit: '15mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/data/:key', (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'clave inválida' });
  const p = keyPath(key);
  if (!fs.existsSync(p)) return res.json(null);
  try {
    res.type('json').send(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    res.status(500).json({ error: 'no se pudo leer ' + key });
  }
});

app.put('/data/:key', (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'clave inválida' });
  try {
    writeJsonAtomic(keyPath(key), req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'no se pudo guardar ' + key });
  }
});

app.listen(PORT, () => console.log('saspy-dataserver escuchando en :' + PORT + ' (datos en ' + DATA_DIR + ')'));
