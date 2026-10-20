# Solar

Panel de producción y consumo de una instalación fotovoltaica (zona de Barcelona, hora de Europe/Madrid).

**Los datos están cifrados.** `data/solar.enc.json` va cifrado con AES-256-GCM. La clave sale de la contraseña con PBKDF2-SHA256; las iteraciones vienen del propio archivo. La web lo descifra en el navegador. En este repositorio no hay datos en claro ni la contraseña de la instalación.

## Uso

Hace falta un servidor local: WebCrypto no funciona al abrir el archivo directamente.

```bash
python3 -m http.server 8080
```

Entrá a <http://localhost:8080/> y escribí la contraseña. «Recordarme en este dispositivo» guarda la clave derivada, no la contraseña. «Cerrar sesión» la borra.

`data/demo.enc.json` son datos **ficticios**, con el mismo esquema. Para verlos: <http://localhost:8080/?demo=1> y la contraseña `demo`.

## GitHub Pages

El sitio es estático (HTML, CSS y JS en la raíz, sin compilación). El workflow `.github/workflows/pages.yml` publica la rama `main`. En el repositorio hay que permitir Pages con origen «GitHub Actions».

## Datos

No edites `data/*.enc.json`: los reemplaza un proceso externo. El esquema y el cifrado están en `docs/DATA_SCHEMA.md`.

Los gráficos usan [Apache ECharts](https://echarts.apache.org/) 5.6.0 (Apache-2.0), incluido en `vendor/`.
