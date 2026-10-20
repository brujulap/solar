# Esquema de datos (`data/*.enc.json`)

Los datos se publican **cifrados**. La web los descarga y los descifra en el navegador con la contraseña que introduce el usuario (WebCrypto). En el repo no hay ningún dato en claro.

| Archivo | Contraseña | Contenido |
|---|---|---|
| `data/solar.enc.json` | la del sitio (privada) | datos reales del sistema |
| `data/demo.enc.json` | `demo` | **datos ficticios**, mismo esquema, para desarrollar la web |

## Envoltorio cifrado

```json
{ "v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "cipher": "AES-256-GCM",
  "salt_b64": "<16 bytes base64>", "iv_b64": "<12 bytes base64>", "ct_b64": "<ciphertext||tag base64>" }
```

- Clave: `PBKDF2(SHA-256, password UTF-8, salt, iter)` → 256 bits.
- Cifrado: AES-256-GCM, IV de 12 bytes, sin AAD. `ct_b64` = texto cifrado con la etiqueta GCM de 16 bytes **al final** (el formato que espera `crypto.subtle.decrypt`).
- Sal e IV aleatorios en cada publicación. Usar siempre `iter` del archivo (no hardcodear).
- Contraseña incorrecta ⇒ `decrypt` lanza `OperationError`.

## Descifrar en el navegador

```js
async function loadSolar(url, password) {
  const env = await (await fetch(url, { cache: "no-store" })).json();
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: b64(env.salt_b64), iterations: env.iter },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(env.iv_b64) }, key, b64(env.ct_b64));
  return JSON.parse(new TextDecoder().decode(pt)); // lanza error si la contraseña es incorrecta
}
// const data = await loadSolar("data/demo.enc.json", "demo");
```

(La derivación con 600.000 iteraciones tarda ~0,3–1 s; conviene mostrar un "descifrando…".)

## JSON descifrado

Convenciones: energía en **Wh**, potencia en **W**, porcentajes 0–100. Fechas `YYYY-MM-DD` y horas ISO 8601 en **Europe/Madrid** con su offset (`+01:00`/`+02:00`). `null` = dato no disponible (nunca se inventa).

### `meta`
| Campo | Descripción |
|---|---|
| `schema_version` | `1` |
| `demo` | `true` sólo en el archivo de demo |
| `generated_at` | última actualización (ISO, hora de Madrid) |
| `timezone` | `"Europe/Madrid"` |
| `units` | `{energy:"Wh", power:"W", pct:"0-100"}` |
| `system` | `{id, location, size_w, modules, inverters, battery, operational_date, source}` |
| `lifetime_production_wh` | producción total oficial de Enphase (se actualiza ~1 vez al día) |
| `lifetime_production_wh_sum_of_daily` | suma de `daily[].production_wh` (incluye hoy) |
| `data_range` | `{first_date, last_date}` |
| `availability` | por métrica: `"available"`, `"derived"` o `"unavailable"`: `production_daily`, `production_intraday`, `consumption_daily`, `consumption_intraday`, `import_export`, `self_consumption`, `battery` (`"none"`) |
| `notes` | notas en texto |

### `today`
`{date, production_wh, consumption_wh, import_wh, export_wh, current_power_w, last_interval_end, last_report_at, status}`. Es un día parcial: la producción sale de `/summary` y el consumo y la importación/exportación de las curvas de 15 min (provisionales).

### `daily[]` (un elemento por día, desde la puesta en marcha hasta hoy)
| Campo | Descripción |
|---|---|
| `date` | `YYYY-MM-DD` |
| `production_wh` | producción del día |
| `consumption_wh` | consumo de la casa o `null` |
| `import_wh` / `export_wh` | energía comprada a la red / vertida a la red, o `null` |
| `self_consumption_pct` | `(producción − exportación) / producción`: qué parte de lo producido se usó en casa |
| `self_sufficiency_pct` | `(consumo − importación) / consumo`: qué parte del consumo cubrió el sol |
| `partial` | `true` sólo para hoy |
| `sources` | `{production: "lifetime"\|"summary", consumption: "lifetime"\|"intraday"\|null, import_export: "meter"\|"derived"\|null}` |

### `weekly[]`, `monthly[]`, `yearly[]`
`{key, start, end, days, production_wh, consumption_wh, import_wh, export_wh, avg_daily_production_wh, self_consumption_pct, self_sufficiency_pct}`.
`key`: semana ISO `"2026-W43"` (lunes a domingo), mes `"2026-10"`, año `"2026"`. El primer y el último grupo pueden estar incompletos (mirar `days`).

### `records`
`best_production_day {date, production_wh}`, `worst_production_day` (el mínimo > 0), `best_production_week {key, start, production_wh}` (sólo semanas completas), `best_production_month {key, production_wh}`, `best_production_year {key, production_wh, days}`, `highest_consumption_day {date, consumption_wh}`, `peak_15min_power_last_days {t, power_w}` (sobre las curvas incluidas), `avg_daily_production_wh`, `days_with_data`. Cualquiera puede ser `null`.

### `intraday`
Objeto indexado por fecha (últimos ~31 días disponibles):
```
"2026-01-01": { "interval_minutes": 15, "production_wh": 1000, "consumption_wh": 2000,
  "points": [ { "t": "2026-01-01T10:00:00+01:00", "production_wh": 50, "production_w": 200,
               "consumption_wh": 75, "consumption_w": 300, "import_wh": 25, "export_wh": 0 }, ... ] }   // valores inventados
```
`t` = **inicio** del intervalo de 15 min. `*_w` = potencia media del intervalo (`wh × 4`). `import_wh`/`export_wh` por intervalo son **derivados** (`max(0, consumo − producción)` / `max(0, producción − consumo)`) y sólo aparecen si hay ambas curvas. El día de hoy acaba en el último intervalo reportado.

## Ejemplo (extracto de `demo.enc.json`, datos ficticios)

```json
{
  "meta": {
    "schema_version": 1,
    "demo": true,
    "generated_at": "2026-10-20T15:15:53+02:00",
    "timezone": "Europe/Madrid",
    "units": {
      "energy": "Wh",
      "power": "W",
      "pct": "0-100"
    },
    "system": {
      "id": 0,
      "location": "DEMO - Villa Ficticia",
      "size_w": 4000,
      "modules": 10,
      "inverters": "DATOS FICTICIOS DE EJEMPLO",
      "battery": false,
      "operational_date": "2024-01-01",
      "source": "demo"
    },
    "lifetime_production_wh": 9340431,
    "lifetime_production_wh_sum_of_daily": 9340431,
    "data_range": {
      "first_date": "2024-01-01",
      "last_date": "2026-10-20"
    },
    "availability": {
      "production_daily": "available",
      "production_intraday": "available",
      "consumption_daily": "available",
      "consumption_intraday": "available",
      "import_export": "available",
      "self_consumption": "available",
      "battery": "none"
    },
    "notes": [
      "DEMO: todos los números de este archivo son inventados, sólo para desarrollar la web.",
      "Valores null = dato no disponible en este sistema (no se inventa nada).",
      "import/export 'derived' = calculado intervalo a intervalo (15 min) como max(0, consumo-producción) / max(0, producción-consumo); sólo en días con curva de consumo.",
      "El día de hoy es parcial (partial=true); sus valores salen de /summary y de las curvas de 15 min hasta que Enphase publica el diario.",
      "daily[].sources indica de dónde sale cada valor: lifetime/meter = medidor Enphase, summary/intraday = provisional, derived = calculado."
    ]
  },
  "today": {
    "date": "2026-10-20",
    "production_wh": 16758,
    "consumption_wh": 12079,
    "import_wh": 4906,
    "export_wh": 9585,
    "current_power_w": 1234,
    "last_interval_end": "2026-10-20T15:15:00+02:00",
    "last_report_at": "2026-10-20T15:15:00+02:00",
    "status": "normal"
  },
  "daily": [
    {
      "date": "2026-10-19",
      "production_wh": 6886,
      "consumption_wh": 13614,
      "import_wh": 11143,
      "export_wh": 4415,
      "self_consumption_pct": 35.9,
      "self_sufficiency_pct": 18.2,
      "partial": false,
      "sources": {
        "production": "lifetime",
        "consumption": "lifetime",
        "import_export": "meter"
      }
    },
    {
      "date": "2026-10-20",
      "production_wh": 16758,
      "consumption_wh": 12079,
      "import_wh": 4906,
      "export_wh": 9585,
      "self_consumption_pct": 42.8,
      "self_sufficiency_pct": 59.4,
      "partial": true,
      "sources": {
        "production": "summary",
        "consumption": "intraday",
        "import_export": "derived"
      }
    }
  ],
  "weekly": [
    {
      "key": "2026-W43",
      "start": "2026-10-19",
      "end": "2026-10-20",
      "days": 2,
      "production_wh": 23644,
      "consumption_wh": 25693,
      "import_wh": 16049,
      "export_wh": 14000,
      "avg_daily_production_wh": 11822,
      "self_consumption_pct": 40.8,
      "self_sufficiency_pct": 37.5
    }
  ],
  "monthly": [
    {
      "key": "2026-10",
      "start": "2026-10-01",
      "end": "2026-10-20",
      "days": 20,
      "production_wh": 158456,
      "consumption_wh": 247286,
      "import_wh": 170503,
      "export_wh": 81673,
      "avg_daily_production_wh": 7923,
      "self_consumption_pct": 48.5,
      "self_sufficiency_pct": 31.1
    }
  ],
  "yearly": [
    {
      "key": "2026",
      "start": "2026-01-01",
      "end": "2026-10-20",
      "days": 293,
      "production_wh": 2827292,
      "consumption_wh": 3705737,
      "import_wh": 2282001,
      "export_wh": 1382940,
      "avg_daily_production_wh": 9649,
      "self_consumption_pct": 51.1,
      "self_sufficiency_pct": 38.4
    }
  ],
  "records": {
    "best_production_day": {
      "date": "2025-07-15",
      "production_wh": 19845
    },
    "worst_production_day": {
      "date": "2025-01-10",
      "production_wh": 2202
    },
    "best_production_week": {
      "key": "2024-W28",
      "start": "2024-07-08",
      "production_wh": 113679
    },
    "best_production_month": {
      "key": "2025-07",
      "production_wh": 430604
    },
    "best_production_year": {
      "key": "2025",
      "production_wh": 3274805,
      "days": 365
    },
    "highest_consumption_day": {
      "date": "2026-01-04",
      "consumption_wh": 18930
    },
    "peak_15min_power_last_days": {
      "t": "2026-10-20T13:30:00+02:00",
      "power_w": 3536
    },
    "avg_daily_production_wh": 9114,
    "days_with_data": 1023
  },
  "intraday": {
    "2026-10-20": {
      "interval_minutes": 15,
      "points": [
        {
          "t": "2026-10-20T12:00:00+02:00",
          "production_wh": 833,
          "production_w": 3332,
          "consumption_wh": 185,
          "consumption_w": 740,
          "import_wh": 0,
          "export_wh": 648
        },
        {
          "t": "2026-10-20T12:15:00+02:00",
          "production_wh": 680,
          "production_w": 2720,
          "consumption_wh": 207,
          "consumption_w": 828,
          "import_wh": 0,
          "export_wh": 473
        }
      ],
      "production_wh": 16758,
      "consumption_wh": 12079
    }
  }
}
```
