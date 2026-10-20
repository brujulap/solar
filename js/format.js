const TZ = "Europe/Madrid";

export function isNum(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

const GROUP_SEPARATOR = /[.\u00a0\u202f\u2009]/;

function intlGroupsThousands() {
  try {
    const sample = new Intl.NumberFormat("es-ES", {
      useGrouping: "always",
      minimumGroupingDigits: 1,
      maximumFractionDigits: 0,
    }).format(4907);
    return sample !== "4907" && GROUP_SEPARATOR.test(sample);
  } catch {
    return false;
  }
}

const USE_INTL_GROUPING = intlGroupsThousands();

function manualGroup(value, minDigits, maxDigits) {
  const negative = value < 0;
  const factor = 10 ** maxDigits;
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
  const sign = negative && rounded !== 0 ? "\u2212" : "";
  let intPart;
  let frac = "";
  if (maxDigits > 0) {
    const [whole, fraction = ""] = rounded.toFixed(maxDigits).split(".");
    intPart = whole;
    frac = fraction.replace(/0+$/, "");
    while (frac.length < minDigits) frac += "0";
  } else {
    intPart = String(Math.trunc(rounded));
  }
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${sign}${grouped},${frac}` : `${sign}${grouped}`;
}

function formatDigits(value, minDigits, maxDigits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "sin dato";
  if (!USE_INTL_GROUPING) return manualGroup(n, minDigits, maxDigits);
  try {
    return new Intl.NumberFormat("es-ES", {
      useGrouping: "always",
      minimumGroupingDigits: 1,
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    }).format(n);
  } catch {
    return manualGroup(n, minDigits, maxDigits);
  }
}

export function formatNumber(value, digits) {
  return formatDigits(value, digits, digits);
}

export function formatAxis(value) {
  return formatDigits(value, 0, 1);
}

export function formatInt(value) {
  if (!isNum(value)) return "sin dato";
  return formatDigits(value, 0, 0);
}

function missing() {
  return { text: "sin dato", unit: "", missing: true };
}

export function energyParts(wh) {
  if (!isNum(wh)) return missing();
  const kwh = Number(wh) / 1000;
  const digits = Math.abs(kwh) >= 100 ? 1 : 2;
  return { text: formatNumber(kwh, digits), unit: "kWh", missing: false };
}

export function powerParts(w) {
  if (!isNum(w)) return missing();
  const n = Number(w);
  if (Math.abs(n) >= 1000) {
    const kw = n / 1000;
    const digits = Math.abs(kw - Math.round(kw)) < 1e-9 ? 0 : Math.abs(kw) >= 10 ? 1 : 2;
    return { text: formatNumber(kw, digits), unit: "kW", missing: false };
  }
  return { text: formatNumber(n, 0), unit: "W", missing: false };
}

export function pctParts(value) {
  if (!isNum(value)) return missing();
  return { text: formatNumber(value, 1), unit: "%", missing: false };
}

export function formatEnergyWh(wh) {
  const parts = energyParts(wh);
  return parts.missing ? "sin dato" : `${parts.text} ${parts.unit}`;
}

export function formatPowerW(w) {
  const parts = powerParts(w);
  return parts.missing ? "sin dato" : `${parts.text} ${parts.unit}`;
}

export function formatPct(value) {
  const parts = pctParts(value);
  return parts.missing ? "sin dato" : `${parts.text} ${parts.unit}`;
}

export function formatDelta(a, b) {
  if (!isNum(a) || !isNum(b) || Number(b) === 0) return "sin dato";
  const pct = ((Number(a) - Number(b)) / Math.abs(Number(b))) * 100;
  const body = formatNumber(pct, 1);
  return pct > 0 ? `+${body} %` : `${body} %`;
}

function dateFromISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
}

function stripDots(value) {
  return String(value).replaceAll(".", "");
}

export function formatDayShort(iso) {
  const date = dateFromISODate(iso);
  if (!date) return "sin dato";
  return stripDots(new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
  }).format(date));
}

export function formatDayMedium(iso) {
  const date = dateFromISODate(iso);
  if (!date) return "sin dato";
  return stripDots(new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date));
}

export function formatDayLong(iso) {
  const date = dateFromISODate(iso);
  if (!date) return "sin dato";
  const text = new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatMonthKey(key) {
  const match = /^(\d{4})-(\d{2})$/.exec(key || "");
  if (!match) return "sin dato";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12, 0, 0));
  const text = new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    month: "long",
    year: "numeric",
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatDateTime(iso) {
  const parts = dateTimeParts(iso);
  return parts.missing ? "sin dato" : `${parts.text}, ${parts.unit}`;
}

export function dateTimeParts(iso) {
  if (!iso) return missing();
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return missing();
  const day = stripDots(new Intl.DateTimeFormat("es-ES", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date));
  return { text: day, unit: formatTime(iso), missing: false };
}

export function formatPeriod(grain, item) {
  if (!item) return "Sin dato";
  if (grain === "day") return formatDayMedium(item.date);
  if (grain === "week") {
    const match = /^(\d{4})-W(\d{2})$/.exec(item.key || "");
    const n = match ? String(Number(match[2])) : item.key || "";
    const year = match ? match[1] : "";
    if (item.start && item.end) {
      return `Semana ${n} · ${formatDayShort(item.start)} – ${formatDayShort(item.end)} ${year}`.trim();
    }
    return `Semana ${n}${year ? ` · ${year}` : ""}`;
  }
  if (grain === "month") return formatMonthKey(item.key);
  if (grain === "year") return String(item.key);
  return String(item.key || item.date || "Sin dato");
}

export function formatPeriodCompact(grain, item) {
  if (!item) return "Sin dato";
  if (grain === "week") {
    const match = /^(\d{4})-W(\d{2})$/.exec(item.key || "");
    if (!match) return formatPeriod(grain, item);
    return `Semana ${Number(match[2])} · ${match[1]}`;
  }
  return formatPeriod(grain, item);
}

export function formatAxisLabel(grain, item) {
  if (!item) return "";
  if (grain === "day") return formatDayShort(item.date);
  if (grain === "week") return item.start ? formatDayShort(item.start) : item.key;
  if (grain === "month") {
    const match = /^(\d{4})-(\d{2})$/.exec(item.key || "");
    if (!match) return item.key || "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12, 0, 0));
    return stripDots(new Intl.DateTimeFormat("es-ES", { timeZone: TZ, month: "short" }).format(date));
  }
  return String(item.key);
}

export function formatChartValue(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return "sin dato";
  const digits = unit === "kW" ? 2 : Math.abs(Number(value)) >= 100 ? 1 : 2;
  return `${formatNumber(value, digits)} ${unit}`;
}
