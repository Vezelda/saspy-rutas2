# Motor de ruteo propio (OSRM + VROOM)

Reemplaza el auto-asignar + solver casero de `js/optimizer.js` por un motor de
verdad, sin los límites del free tier de ORS (50 paradas / 3 vehículos por
request). Corre 100% en tu VM, sin depender de ningún servicio externo para
el cálculo de rutas.

- **OSRM**: calcula distancias/tiempos reales sobre el mapa de Paraguay.
- **VROOM**: con esa matriz, decide qué parada va con qué chofer y en qué
  orden (VRP con ventanas horarias).
- **nginx**: única puerta de entrada expuesta a internet, con usuario y
  contraseña — ni OSRM ni VROOM tienen autenticación propia.

## 1. Provisionar la VM

Debian 12, 2-4 vCPU, 6 GB RAM, 30 GB SSD (ver specs completas discutidas en
el chat). Con Docker y Docker Compose instalados:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # cerrá sesión y volvé a entrar después de esto
```

## 2. Copiar esta carpeta a la VM

```bash
scp -r infra/routing-engine usuario@tu-vm:/opt/saspy-routing
ssh usuario@tu-vm
cd /opt/saspy-routing
```

## 3. Preparar el mapa (una sola vez)

```bash
chmod +x prepare-map.sh
./prepare-map.sh
```

Tarda entre 5 y 20 minutos según la VM (Paraguay es un extracto chico, no es
como procesar un país grande). Cuando quieran refrescar el mapa más adelante:
borrar `data/*.osrm*` y `data/paraguay-latest.osm.pbf`, y volver a correr el
script.

## 4. Usuario y contraseña del proxy

```bash
sudo apt install -y apache2-utils
htpasswd -c nginx/.htpasswd admin
```

(`-c` crea el archivo — usalo solo la primera vez; para agregar otro usuario
después, sin `-c`).

## 5. Certificado TLS

**Opción rápida (autofirmado)** — funciona ya mismo, pero el navegador va a
avisar que el certificado no es de confianza la primera vez:

```bash
mkdir -p nginx/certs
openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout nginx/certs/privkey.pem \
  -out nginx/certs/fullchain.pem \
  -subj "/CN=saspy-routing"
```

**Opción real (Let's Encrypt)** — si tienen un dominio apuntando a la IP de
la VM, mejor usar `certbot` y copiar `fullchain.pem`/`privkey.pem` a
`nginx/certs/`. Avisen cuando tengan el dominio y actualizamos esto.

## 6. Levantar todo

```bash
docker compose up -d
docker compose logs -f    # Ctrl+C para salir del log, los contenedores siguen corriendo
```

## 7. Probar que funciona

```bash
curl -sk -u admin \
  -H "Content-Type: application/json" \
  -d '{
    "vehicles": [{"id": 1, "start": [-57.4686, -25.2796], "end": [-57.4686, -25.2796]}],
    "jobs": [
      {"id": 1, "location": [-57.5699, -25.2983]},
      {"id": 2, "location": [-57.6430, -25.2809]}
    ]
  }' \
  https://localhost:8443/
```

Te va a pedir la contraseña que pusiste en el paso 4. Si responde con un JSON
que trae `"routes"` con una secuencia de paradas, el motor está andando.
Desde afuera de la VM, cambiá `localhost:8443` por la IP/dominio real.

## Qué falta después de esto

Una vez que confirmen que este servicio responde bien, el siguiente paso es
cambiar `js/optimizer.js` para que le mande el problema completo (todos los
choferes activos + todas las paradas con paquetes) a este endpoint en vez de
usar el auto-asignar y el solver caseros. Lo hacemos en cuanto avisen que la
VM está lista y probada.
