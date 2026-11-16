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

Convenciones: energía en **Wh**, potencia en **W**, porcentajes 0–100, importes en **EUR con 2 decimales**. Fechas `YYYY-MM-DD` y horas ISO 8601 en **Europe/Madrid** con su offset (`+01:00`/`+02:00`). `null` = dato no disponible (nunca se inventa).

### `meta`
| Campo | Descripción |
|---|---|
| `schema_version` | `1` (los campos de costo son aditivos; no rompen un lector que los ignore) |
| `demo` | `true` sólo en el archivo de demo |
| `generated_at` | última actualización (ISO, hora de Madrid) |
| `timezone` | `"Europe/Madrid"` |
| `units` | `{energy:"Wh", power:"W", pct:"0-100"}` |
| `system` | `{id, location, size_w, modules, inverters, battery, operational_date, source}` |
| `lifetime_production_wh` | producción total oficial de Enphase (se actualiza ~1 vez al día) |
| `lifetime_production_wh_sum_of_daily` | suma de `daily[].production_wh` (incluye hoy) |
| `data_range` | `{first_date, last_date}` |
| `availability` | por métrica: `"available"`, `"derived"` o `"unavailable"`: `production_daily`, `production_intraday`, `consumption_daily`, `consumption_intraday`, `import_export`, `self_consumption`, `battery` (`"none"`) |
| `tariff` | contrato usado para calcular el costo (ver más abajo) |
| `notes` | notas en texto |

### `meta.tariff`
Precios **sin impuestos** de la tarifa niba Tres 2.0TD. Se aplican por igual a todos los días con costo (no hay histórico de cambios de contrato).

| Campo | Descripción |
|---|---|
| `name` | `"niba Tres"` |
| `access_tariff` | `"2.0TD"` |
| `version` | `1` |
| `valid_from` | `null` si no se conoce la fecha de inicio del contrato |
| `power_kw` | `{p1, p2}` potencias contratadas, en kW |
| `power_eur_kw_day` | `{p1, p2}` €/kW·día, sin impuestos |
| `energy_eur_kwh` | `{p1, p2, p3}` €/kWh de punta, llano y valle, sin impuestos |
| `bono_social_eur_day` | €/día, sin impuestos (0,024688) |
| `iee_pct` | `5.11` |
| `iva_pct` | `21` |
| `meter_rental` | `"no incluido"` |
| `excedentes` | `"no incluido"` |
| `periods_rule` | texto: L–V punta 10–14 y 18–22, llano 8–10 / 14–18 / 22–24, valle 0–8 (hora Europe/Madrid, según el **inicio** del intervalo de 15 min). Sábado, domingo y festivo nacional: todo valle. |
| `holidays` | `"nacionales"` (festivos nacionales no sustituibles de la 2.0TD: 1/1, 6/1, Viernes Santo, 1/5, 15/8, 12/10, 1/11, 6/12, 8/12, 25/12; lista fija 2023–2027) |
| `notes` | cómo se aplican IEE e IVA, redondeo y exclusiones |

El IEE (5,11 %) se calcula sobre **energía + potencia + bono social**. Se incluye el bono social en la base porque es un cargo regulado del suministro que en las facturas 2.0TD suele formar parte de esa base. El IVA (21 %) se aplica sobre energía + potencia + bono social + IEE. El alquiler del contador y los excedentes quedan fuera.

### `today`
`{date, production_wh, consumption_wh, import_wh, export_wh, current_power_w, last_interval_end, last_report_at, status}`. Es un día parcial: la producción sale de `/summary` y el consumo y la importación/exportación de las curvas de 15 min (provisionales). El costo de hoy, si hay curva, está en el último elemento de `daily[]` (`partial: true`).

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
| `cost` | objeto de costo del día, o `null` si no hay curva intradía (ni histórica) con importación derivada |

#### `daily[].cost`
Cálculo a partir de la importación **derivada** de las curvas de 15 min (`max(0, consumo − producción)` por intervalo), no un dato de la factura ni una lectura del medidor por periodo. `import_wh_p1 + import_wh_p2 + import_wh_p3` coincide con la suma de `import_wh` de los puntos intradía de ese día; puede diferir de `daily[].import_wh` cuando este último sale del medidor (`sources.import_export = "meter"`).

| Campo | Descripción |
|---|---|
| `import_wh_p1` / `import_wh_p2` / `import_wh_p3` | importación derivada en punta, llano y valle, en Wh enteros |
| `energy_eur` | término de energía (sin impuestos), 2 decimales |
| `power_eur` | término de potencia del día (sin impuestos), 2 decimales |
| `bono_social_eur` | bono social del día (sin impuestos), 2 decimales. El valor contractual 0,024688 € queda en **0,02 €** al redondear |
| `subtotal_eur` | `energy_eur + power_eur + bono_social_eur` |
| `iee_eur` | 5,11 % sobre el subtotal |
| `iva_eur` | 21 % sobre `subtotal_eur + iee_eur` |
| `total_eur` | `subtotal_eur + iee_eur + iva_eur` |
| `excedentes_eur` | siempre `null` (el precio de excedentes no está en el contrato) |
| `method` | `"intraday-derived"` |

Los importes se redondean a 2 decimales con half-up, en este orden: energía, potencia y bono social → subtotal → IEE → IVA → total, de modo que la fórmula se puede verificar con los valores ya redondeados. El día de hoy también lleva `cost` si hay curva; está marcado como parcial vía `partial`, no dentro de `cost`.

Cuando un día sale de la ventana de ~31 días de curvas, el reparto por periodo se conserva en un histórico del generador y el `cost` se sigue publicando.

### `weekly[]`, `monthly[]`, `yearly[]`
`{key, start, end, days, production_wh, consumption_wh, import_wh, export_wh, avg_daily_production_wh, self_consumption_pct, self_sufficiency_pct, cost}`.
`key`: semana ISO `"2026-W43"` (lunes a domingo), mes `"2026-10"`, año `"2026"`. El primer y el último grupo pueden estar incompletos (mirar `days`).

`cost` es `null` si ningún día del grupo tiene costo. Si no, es la **suma de los importes ya redondeados** de los días con costo:

`{energy_eur, power_eur, bono_social_eur, subtotal_eur, iee_eur, iva_eur, total_eur, days_with_cost}`

`days_with_cost` puede ser menor que `days` (sólo se suman los días que tienen curva o histórico). En ese caso el costo del grupo está incompleto.

### `records`
`best_production_day {date, production_wh}`, `worst_production_day` (el mínimo > 0), `best_production_week {key, start, production_wh}` (sólo semanas completas), `best_production_month {key, production_wh}`, `best_production_year {key, production_wh, days}`, `highest_consumption_day {date, consumption_wh}`, `peak_15min_power_last_days {t, power_w}` (sobre las curvas incluidas), `avg_daily_production_wh`, `days_with_data`. Cualquiera puede ser `null`.

### `intraday`
Objeto indexado por fecha (últimos ~31 días disponibles):
```
"2026-01-01": { "interval_minutes": 15, "production_wh": 1000, "consumption_wh": 2000,
  "points": [ { "t": "2026-01-01T10:00:00+01:00", "production_wh": 50, "production_w": 200,
               "consumption_wh": 75, "consumption_w": 300, "import_wh": 25, "export_wh": 0 }, ... ] }   // valores inventados
```
`t` = **inicio** del intervalo de 15 min. `*_w` = potencia media del intervalo (`wh × 4`). `import_wh`/`export_wh` por intervalo son **derivados** (`max(0, consumo − producción)` / `max(0, producción − consumo)`) y sólo aparecen si hay ambas curvas. El día de hoy acaba en el último intervalo reportado. El periodo 2.0TD de cada punto se asigna por la hora local de `t`.

## Ejemplo (extracto de `demo.enc.json`, datos ficticios)

```json
{
  "meta": {
    "schema_version": 1,
    "demo": true,
    "generated_at": "2026-11-16T19:26:26+01:00",
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
    "lifetime_production_wh": 9543120,
    "lifetime_production_wh_sum_of_daily": 9543120,
    "data_range": {
      "first_date": "2024-01-01",
      "last_date": "2026-11-16"
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
    "tariff": {
      "name": "niba Tres",
      "access_tariff": "2.0TD",
      "version": 1,
      "valid_from": null,
      "power_kw": { "p1": 6.9, "p2": 6.9 },
      "power_eur_kw_day": { "p1": 0.079, "p2": 0.059 },
      "energy_eur_kwh": { "p1": 0.196, "p2": 0.169, "p3": 0.089 },
      "bono_social_eur_day": 0.024688,
      "iee_pct": 5.11,
      "iva_pct": 21,
      "meter_rental": "no incluido",
      "excedentes": "no incluido",
      "periods_rule": "L-V punta 10–14 y 18–22, llano 8–10 14–18 22–24, valle 0–8 (hora Europe/Madrid, por el inicio del intervalo de 15 min). Sábado, domingo y festivo nacional: todo valle.",
      "holidays": "nacionales",
      "notes": "Precios sin impuestos, según contrato niba Tres 2.0TD indicado por Bruno. Se aplican por igual a todos los días con costo; no hay histórico de cambios de tarifa. IEE 5,11 % sobre energía + potencia + bono social (el bono social se incluye en la base del IEE por ser un cargo regulado del suministro). IVA 21 % sobre energía + potencia + bono social + IEE. Alquiler del contador y excedentes no incluidos. Los importes diarios se redondean a 2 decimales (half-up)."
    },
    "notes": [
      "DEMO: todos los números de este archivo son inventados, sólo para desarrollar la web.",
      "Valores null = dato no disponible en este sistema (no se inventa nada).",
      "import/export 'derived' = calculado intervalo a intervalo (15 min) como max(0, consumo-producción) / max(0, producción-consumo); sólo en días con curva de consumo.",
      "El día de hoy es parcial (partial=true); sus valores salen de /summary y de las curvas de 15 min hasta que Enphase publica el diario.",
      "daily[].sources indica de dónde sale cada valor: lifetime/meter = medidor Enphase, summary/intraday = provisional, derived = calculado.",
      "El costo diario (daily[].cost) es un cálculo a partir de la importación derivada de las curvas de 15 min (method=intraday-derived), no un dato de la factura. El import por periodo (p1/p2/p3) es derivado. Solo hay costo en días con curva (o conservados en el histórico de repartos); el resto lleva cost=null. Alquiler del contador y excedentes no están incluidos."
    ]
  },
  "today": {
    "date": "2026-11-16",
    "production_wh": 21483,
    "consumption_wh": 15398,
    "import_wh": 5918,
    "export_wh": 12003,
    "current_power_w": 1234,
    "last_interval_end": "2026-11-16T19:15:00+01:00",
    "last_report_at": "2026-11-16T19:15:00+01:00",
    "status": "normal"
  },
  "daily": [
    {
      "date": "2026-11-09",
      "production_wh": 3602,
      "consumption_wh": 12168,
      "import_wh": 9982,
      "export_wh": 1416,
      "self_consumption_pct": 60.7,
      "self_sufficiency_pct": 18.0,
      "partial": false,
      "sources": {
        "production": "lifetime",
        "consumption": "lifetime",
        "import_export": "meter"
      },
      "cost": null
    },
    {
      "date": "2026-11-10",
      "production_wh": 7096,
      "consumption_wh": 15544,
      "import_wh": 11014,
      "export_wh": 2566,
      "self_consumption_pct": 63.8,
      "self_sufficiency_pct": 29.1,
      "partial": false,
      "sources": {
        "production": "lifetime",
        "consumption": "lifetime",
        "import_export": "meter"
      },
      "cost": {
        "import_wh_p1": 6139,
        "import_wh_p2": 2465,
        "import_wh_p3": 5152,
        "energy_eur": 2.08,
        "power_eur": 0.95,
        "bono_social_eur": 0.02,
        "subtotal_eur": 3.05,
        "iee_eur": 0.16,
        "iva_eur": 0.67,
        "total_eur": 3.88,
        "excedentes_eur": null,
        "method": "intraday-derived"
      }
    },
    {
      "date": "2026-11-16",
      "production_wh": 21483,
      "consumption_wh": 15398,
      "import_wh": 5918,
      "export_wh": 12003,
      "self_consumption_pct": 44.1,
      "self_sufficiency_pct": 61.6,
      "partial": true,
      "sources": {
        "production": "summary",
        "consumption": "intraday",
        "import_export": "derived"
      },
      "cost": {
        "import_wh_p1": 861,
        "import_wh_p2": 117,
        "import_wh_p3": 4940,
        "energy_eur": 0.63,
        "power_eur": 0.95,
        "bono_social_eur": 0.02,
        "subtotal_eur": 1.6,
        "iee_eur": 0.08,
        "iva_eur": 0.35,
        "total_eur": 2.03,
        "excedentes_eur": null,
        "method": "intraday-derived"
      }
    }
  ],
  "weekly": [
    {
      "key": "2026-W46",
      "start": "2026-11-09",
      "end": "2026-11-15",
      "days": 7,
      "production_wh": 39125,
      "consumption_wh": 105565,
      "import_wh": 84550,
      "export_wh": 18110,
      "avg_daily_production_wh": 5589,
      "self_consumption_pct": 53.7,
      "self_sufficiency_pct": 19.9,
      "cost": {
        "energy_eur": 10.65,
        "power_eur": 5.7,
        "bono_social_eur": 0.12,
        "subtotal_eur": 16.47,
        "iee_eur": 0.85,
        "iva_eur": 3.63,
        "total_eur": 20.95,
        "days_with_cost": 6
      }
    }
  ],
  "monthly": [
    {
      "key": "2026-11",
      "start": "2026-11-01",
      "end": "2026-11-16",
      "days": 16,
      "production_wh": 116049,
      "consumption_wh": 229491,
      "import_wh": 172031,
      "export_wh": 58589,
      "avg_daily_production_wh": 7253,
      "self_consumption_pct": 49.5,
      "self_sufficiency_pct": 25.0,
      "cost": {
        "energy_eur": 11.28,
        "power_eur": 6.65,
        "bono_social_eur": 0.14,
        "subtotal_eur": 18.07,
        "iee_eur": 0.93,
        "iva_eur": 3.98,
        "total_eur": 22.98,
        "days_with_cost": 7
      }
    }
  ],
  "yearly": [
    {
      "key": "2026",
      "start": "2026-01-01",
      "end": "2026-11-16",
      "days": 320,
      "production_wh": 3029981,
      "consumption_wh": 4086606,
      "import_wh": 2567831,
      "export_wh": 1490590,
      "avg_daily_production_wh": 9469,
      "self_consumption_pct": 50.8,
      "self_sufficiency_pct": 37.2,
      "cost": {
        "energy_eur": 11.28,
        "power_eur": 6.65,
        "bono_social_eur": 0.14,
        "subtotal_eur": 18.07,
        "iee_eur": 0.93,
        "iva_eur": 3.98,
        "total_eur": 22.98,
        "days_with_cost": 7
      }
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
      "t": "2026-11-10T12:45:00+01:00",
      "power_w": 3588
    },
    "avg_daily_production_wh": 9068,
    "days_with_data": 1050
  },
  "intraday": {
    "2026-11-10": {
      "interval_minutes": 15,
      "points": [
        {
          "t": "2026-11-10T12:00:00+01:00",
          "production_wh": 812,
          "production_w": 3248,
          "consumption_wh": 208,
          "consumption_w": 832,
          "import_wh": 0,
          "export_wh": 604
        },
        {
          "t": "2026-11-10T12:15:00+01:00",
          "production_wh": 789,
          "production_w": 3156,
          "consumption_wh": 239,
          "consumption_w": 956,
          "import_wh": 0,
          "export_wh": 550
        }
      ],
      "production_wh": 21548,
      "consumption_wh": 23491
    }
  }
}
```
