# ☀️ Solar

Panel de producción y consumo de una instalación fotovoltaica (Enphase, 3,48 kW).

**Los datos están cifrados.** `data/solar.enc.json` va cifrado con AES-256-GCM y una clave derivada de una contraseña (PBKDF2-SHA256, 600.000 iteraciones). La web lo descifra en el navegador sólo si se introduce la contraseña correcta. En este repositorio no hay datos en claro ni credenciales.

- `data/solar.enc.json`: datos reales (cifrados), se actualizan automáticamente.
- `data/demo.enc.json`: datos **ficticios** de ejemplo (contraseña `demo`) para desarrollar la web.
- `docs/DATA_SCHEMA.md`: esquema de los datos y cómo descifrarlos.
