function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

function weekSortKey(key) {
  const match = /^(\d{4})-W(\d+)$/.exec(key || "");
  if (!match) return key || "";
  return `${match[1]}-${String(match[2]).padStart(3, "0")}`;
}

export function indexData(data) {
  const src = data || {};
  const daily = asArray(src.daily)
    .filter((item) => item && item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const weekly = asArray(src.weekly)
    .filter((item) => item && item.key)
    .sort((a, b) => weekSortKey(a.key).localeCompare(weekSortKey(b.key)));
  const monthly = asArray(src.monthly)
    .filter((item) => item && item.key)
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const yearly = asArray(src.yearly)
    .filter((item) => item && item.key)
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const intraday = src.intraday && typeof src.intraday === "object" ? src.intraday : {};
  const intradayDates = Object.keys(intraday)
    .filter((key) => intraday[key] && Array.isArray(intraday[key].points))
    .sort();
  return {
    daily,
    weekly,
    monthly,
    yearly,
    intraday,
    intradayDates,
    byDate: new Map(daily.map((item) => [item.date, item])),
    meta: src.meta || {},
    today: src.today || {},
    records: src.records || {},
  };
}

export function periodList(indexed, grain) {
  if (grain === "day") return indexed.daily;
  if (grain === "week") return indexed.weekly;
  if (grain === "month") return indexed.monthly;
  if (grain === "year") return indexed.yearly;
  return [];
}

export function periodId(grain, item) {
  return grain === "day" ? item.date : item.key;
}

export function findItem(indexed, grain, id) {
  if (!id) return null;
  return periodList(indexed, grain).find((item) => periodId(grain, item) === id) || null;
}

export function latestId(indexed, grain) {
  const list = periodList(indexed, grain);
  return list.length ? periodId(grain, list[list.length - 1]) : null;
}

export function neighborId(indexed, grain, id, direction) {
  const list = periodList(indexed, grain);
  const index = list.findIndex((item) => periodId(grain, item) === id);
  if (index < 0) return null;
  const next = list[index + direction];
  return next ? periodId(grain, next) : null;
}

export function contextItems(indexed, grain, id) {
  const all = periodList(indexed, grain);
  if (!id || grain === "year") return all;
  if (grain === "day") return all.filter((item) => item.date.slice(0, 7) === id.slice(0, 7));
  if (grain === "week") return all.filter((item) => item.key.slice(0, 4) === id.slice(0, 4));
  if (grain === "month") return all.filter((item) => item.key.slice(0, 4) === id.slice(0, 4));
  return all;
}

export function samePeriodLastYear(grain, id) {
  if (!id) return null;
  if (grain === "day") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
    return match ? `${Number(match[1]) - 1}-${match[2]}-${match[3]}` : null;
  }
  if (grain === "week") {
    const match = /^(\d{4})-W(\d{2})$/.exec(id);
    return match ? `${Number(match[1]) - 1}-W${match[2]}` : null;
  }
  if (grain === "month") {
    const match = /^(\d{4})-(\d{2})$/.exec(id);
    return match ? `${Number(match[1]) - 1}-${match[2]}` : null;
  }
  if (grain === "year" && /^\d{4}$/.test(id)) return String(Number(id) - 1);
  return null;
}

export function anchorDateOf(indexed, grain, id) {
  if (!id) return null;
  if (grain === "day") return id;
  if (grain === "week") {
    const item = indexed.weekly.find((entry) => entry.key === id);
    return item?.end || item?.start || null;
  }
  if (grain === "month") return indexed.monthly.find((entry) => entry.key === id)?.end || null;
  if (grain === "year") return indexed.yearly.find((entry) => entry.key === id)?.end || null;
  return null;
}

export function translateId(indexed, fromGrain, id, toGrain) {
  if (fromGrain === toGrain) return id || latestId(indexed, toGrain);
  const anchor = anchorDateOf(indexed, fromGrain, id);
  if (!anchor) return latestId(indexed, toGrain);
  if (toGrain === "day") {
    if (indexed.byDate.has(anchor)) return anchor;
    const days = indexed.daily.filter((item) => item.date.startsWith(anchor.slice(0, 7)));
    return days.length ? days[days.length - 1].date : latestId(indexed, "day");
  }
  if (toGrain === "month") {
    const key = anchor.slice(0, 7);
    return indexed.monthly.some((item) => item.key === key) ? key : latestId(indexed, "month");
  }
  if (toGrain === "year") {
    const key = anchor.slice(0, 4);
    return indexed.yearly.some((item) => item.key === key) ? key : latestId(indexed, "year");
  }
  if (toGrain === "week") {
    const week = indexed.weekly.find((item) => item.start <= anchor && anchor <= item.end);
    return week ? week.key : latestId(indexed, "week");
  }
  return latestId(indexed, toGrain);
}

export function ensureId(indexed, grain, id) {
  if (findItem(indexed, grain, id)) return id;
  return latestId(indexed, grain);
}

export function isIncomplete(grain, item) {
  if (!item) return false;
  if (grain === "day") return item.partial === true;
  if (!finite(item.days)) return false;
  const days = Number(item.days);
  if (grain === "week") return days < 7;
  if (grain === "month") {
    const match = /^(\d{4})-(\d{2})$/.exec(item.key || "");
    if (!match) return false;
    const dim = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
    return days < dim;
  }
  if (grain === "year") {
    const year = Number(item.key);
    if (!Number.isFinite(year)) return false;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return days < (leap ? 366 : 365);
  }
  return false;
}

export function isCalculated(kind, day, availability = {}) {
  const sources = day?.sources || {};
  if (kind === "production") return sources.production === "derived" || availability.production_daily === "derived";
  if (kind === "consumption") return sources.consumption === "derived" || availability.consumption_daily === "derived";
  if (kind === "import" || kind === "export") {
    return sources.import_export === "derived" || availability.import_export === "derived";
  }
  if (kind === "self_consumption" || kind === "self_sufficiency") {
    return availability.self_consumption === "derived";
  }
  return false;
}

export function netWh(item) {
  if (!item || !finite(item.import_wh) || !finite(item.export_wh)) return null;
  return Number(item.export_wh) - Number(item.import_wh);
}

export function batteryLabel(meta) {
  const battery = meta?.system?.battery;
  const availability = meta?.availability?.battery;
  if (battery === true) return "con batería";
  if (battery === false || availability === "none") return "sin batería";
  return null;
}

export function daysOf(indexed, grain, item) {
  if (!item) return [];
  if (grain === "day") return [item];
  if (!item.start || !item.end) return [];
  return indexed.daily.filter((day) => day.date >= item.start && day.date <= item.end);
}

export function hasDerivedImport(indexed, grain, items) {
  if (indexed.meta?.availability?.import_export === "derived") return true;
  return items.some((item) => daysOf(indexed, grain, item).some((day) => day.sources?.import_export === "derived"));
}

export function kwhOrNull(wh) {
  return finite(wh) ? Number(wh) / 1000 : null;
}

export function kwOrNull(w) {
  return finite(w) ? Number(w) / 1000 : null;
}

export function openIntervalIndex(points, intervalMinutes, lastIntervalEnd) {
  if (!Array.isArray(points) || points.length < 2 || !lastIntervalEnd) return -1;
  const minutes = finite(intervalMinutes) ? Number(intervalMinutes) : 15;
  const last = points.length - 1;
  const start = Date.parse(points[last]?.t);
  const clock = Date.parse(lastIntervalEnd);
  if (!Number.isFinite(start) || !Number.isFinite(clock)) return -1;
  const nominalEnd = start + minutes * 60 * 1000;
  if (clock >= start - 1000 && clock < nominalEnd - 1000) return last;
  return -1;
}
