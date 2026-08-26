// geocode.js — Geocodificación de paradas usando OpenRouteService

const Geocode = {

  BASE_URL: 'https://api.openrouteservice.org/geocode/search',

  // Geocodifica una parada individual
  async geocodeStop(stop, apiKey) {
    const query = encodeURIComponent(stop.address);
    const url = `${this.BASE_URL}?api_key=${apiKey}&text=${query}&boundary.country=PY&size=1`;

    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Error HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.features || data.features.length === 0) {
      throw new Error('No se encontraron resultados para esta dirección');
    }

    const [lng, lat] = data.features[0].geometry.coordinates;
    return { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
  },

  // Geocodifica todas las paradas que no tienen coordenadas
  // onProgress(current, total, stopName) — callback de progreso
  async geocodeAll(apiKey, onProgress) {
    const stops = Storage.getStops();
    const pending = stops.filter(s => s.lat === null && s.type !== 'DEPOT' && s.active !== false);
    const total = pending.length;
    let done = 0;
    let errors = [];

    for (const stop of pending) {
      try {
        onProgress && onProgress(done, total, stop.name);
        const coords = await this.geocodeStop(stop, apiKey);
        Storage.updateStop(stop.id, { lat: coords.lat, lng: coords.lng });
        done++;
        // Pausa para no saturar la API (máx ~1 req/seg gratis)
        await this._sleep(1100);
      } catch (e) {
        errors.push({ id: stop.id, name: stop.name, error: e.message });
        done++;
        await this._sleep(500);
      }
    }

    onProgress && onProgress(total, total, 'Completado');
    return { done, errors };
  },

  // Geocodifica solo una parada por ID
  async geocodeSingle(stopId, apiKey) {
    const stops = Storage.getStops();
    const stop = stops.find(s => s.id === stopId);
    if (!stop) throw new Error('Parada no encontrada');
    const coords = await this.geocodeStop(stop, apiKey);
    Storage.updateStop(stopId, { lat: coords.lat, lng: coords.lng });
    return coords;
  },

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
};
