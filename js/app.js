import {
  bytesToB64,
  clearDerivedKey,
  decryptWithKey,
  decryptWithPassword,
  importStoredKey,
  readDerivedKey,
  writeDerivedKey,
} from "./crypto.js";
import {
  dateTimeParts,
  energyParts,
  formatAxisLabel,
  formatDateTime,
  formatDayLong,
  formatDayMedium,
  formatDelta,
  formatEnergyWh,
  formatInt,
  formatMonthKey,
  formatPeriod,
  formatPeriodCompact,
  formatPct,
  formatPowerW,
  formatTime,
  isNum,
  pctParts,
  powerParts,
} from "./format.js";
import {
  batteryLabel,
  contextItems,
  ensureId,
  findItem,
  hasDerivedImport,
  indexData,
  isCalculated,
  isIncomplete,
  kwhOrNull,
  kwOrNull,
  latestId,
  neighborId,
  netWh,
  periodId,
  periodList,
  samePeriodLastYear,
  translateId,
} from "./model.js";
import { disposeCharts, resizeCharts, setChart } from "./charts.js";

const VIEWS = [
  ["hoy", "Hoy"],
  ["curva", "Curva"],
  ["periodos", "Periodos"],
  ["comparar", "Comparar"],
  ["red", "Red"],
  ["records", "Récords"],
];
const THEME_KEY = "solar.theme";

const state = {
  dataset: "solar",
  url: "data/solar.enc.json",
  envelope: null,
  indexed: null,
  view: "hoy",
  period: { grain: "day", id: null },
  grid: { grain: "day", id: null },
  compare: { grain: "month", a: null, b: null },
  curveDate: null,
};

let bound = false;

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "disabled") node.disabled = true;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function badge(text) {
  return h("span", { class: "badge", text });
}

function labelOf(view) {
  return VIEWS.find(([id]) => id === view)?.[1] || "Solar";
}

function viewFromHash() {
  const name = location.hash.replace("#", "");
  return VIEWS.some(([id]) => id === name) ? name : null;
}

function alive(values) {
  return values.some((value) => value != null && !Number.isNaN(value));
}

function availability() {
  return state.indexed?.meta?.availability || {};
}

function syncThemeButton() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const button = document.getElementById("theme-toggle");
  button.setAttribute("aria-label", dark ? "Activar tema claro" : "Activar tema oscuro");
  button.setAttribute("aria-pressed", dark ? "true" : "false");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#100f0c" : "#f3eee6";
}

function showLogin(message, { error = false, busy = false, busyLabel = "Descifrando…" } = {}) {
  document.getElementById("app").hidden = true;
  document.getElementById("login").hidden = false;
  document.title = "Solar";
  const err = document.getElementById("login-error");
  const status = document.getElementById("login-status");
  err.hidden = !(error && message);
  err.textContent = error && message ? message : "";
  status.textContent = !error && message ? message : "";
  const input = document.getElementById("password");
  const submit = document.getElementById("login-submit");
  input.disabled = busy;
  input.setAttribute("aria-invalid", error ? "true" : "false");
  submit.disabled = busy;
  submit.textContent = busy ? busyLabel : "Entrar";
  document.getElementById("remember").disabled = busy;
  document.getElementById("toggle-password").disabled = busy;
  document.getElementById("login-demo").hidden = state.dataset !== "demo";
  if (!busy) {
    input.focus();
    if (error) input.select();
  }
}

function contextBlurb(grain, id) {
  if (!id) return "";
  if (grain === "day") return `Días de ${formatMonthKey(id.slice(0, 7))}`;
  if (grain === "week") return `Semanas de ${id.slice(0, 4)}`;
  if (grain === "month") return `Meses de ${id.slice(0, 4)}`;
  return "Años disponibles";
}

function balanceEntry(item) {
  const net = netWh(item);
  if (net == null) {
    return {
      parts: { text: "sin dato", unit: "", missing: true },
      hint: "Exportación menos importación",
    };
  }
  const word = net > 0 ? "Vertido neto" : net < 0 ? "Compra neta" : "Equilibrio";
  return {
    parts: energyParts(Math.abs(net)),
    hint: `${word} · exportación − importación`,
  };
}

function detailEntries(item, grain) {
  const av = availability();
  const day = grain === "day" ? item : null;
  const balance = balanceEntry(item);
  const entries = [
    ["Producción", energyParts(item?.production_wh), isCalculated("production", day, av)],
    ["Consumo", energyParts(item?.consumption_wh), isCalculated("consumption", day, av)],
    ["Importación", energyParts(item?.import_wh), isCalculated("import", day, av)],
    ["Exportación", energyParts(item?.export_wh), isCalculated("export", day, av)],
    ["Autoconsumo", pctParts(item?.self_consumption_pct), isCalculated("self_consumption", day, av), "Parte de la producción usada en casa"],
    ["Autosuficiencia", pctParts(item?.self_sufficiency_pct), isCalculated("self_sufficiency", day, av), "Parte del consumo cubierta por el sol"],
  ];
  if (item && isNum(item.avg_daily_production_wh)) {
    entries.push(["Media diaria", energyParts(item.avg_daily_production_wh), false]);
  }
  entries.push(["Balance de red", balance.parts, false, balance.hint]);
  return entries;
}

function renderStats(container, entries) {
  container.replaceChildren();
  for (const [label, parts, calc, hint] of entries) {
    const title = h("span", {}, [document.createTextNode(label)]);
    if (calc) title.append(badge("calculado"));
    const value = parts.missing ? "sin dato" : `${parts.text}${parts.unit ? ` ${parts.unit}` : ""}`;
    container.append(h("div", { class: "stat" }, [
      title,
      h("b", { class: parts.missing ? "missing" : "", text: value }),
      hint ? h("small", { text: hint }) : null,
    ]));
  }
}

function metricCard({ kind, label, parts, calc, hint }) {
  const article = h("article", { class: "card", "data-kind": kind, "data-metric": kind }, [
    h("div", { class: "card-head" }, [
      h("h3", { text: label }),
      calc ? badge("calculado") : null,
    ]),
    h("p", { class: parts.missing ? "value missing" : (parts.stacked ? "value value-time" : "value") }, [
      document.createTextNode(parts.text),
      parts.unit ? h("span", { class: "unit", text: parts.stacked ? parts.unit : `\u00a0${parts.unit}` }) : null,
    ]),
    hint ? h("p", { class: "hint", text: hint }) : null,
  ]);
  if (calc) article.dataset.calculated = "true";
  return article;
}

function renderBalance(today) {
  const root = document.getElementById("hoy-balance");
  root.replaceChildren();
  const rows = [
    ["Producción", today.production_wh, "prod"],
    ["Consumo", today.consumption_wh, "cons"],
  ];
  const max = Math.max(0, ...rows.map((row) => (isNum(row[1]) ? Number(row[1]) : 0)));
  for (const [label, wh, kind] of rows) {
    const parts = energyParts(wh);
    const width = isNum(wh) && max > 0 ? Math.max(2, (Number(wh) / max) * 100) : 0;
    const fill = h("div", { class: `fill ${kind}` });
    fill.style.width = `${width}%`;
    root.append(h("div", { class: "bal-row" }, [
      h("span", { class: "bal-label", text: label }),
      h("div", { class: "track", "aria-hidden": "true" }, [fill]),
      h("b", { text: parts.missing ? "sin dato" : `${parts.text} ${parts.unit}` }),
    ]));
  }
  if (isNum(today.production_wh) && isNum(today.consumption_wh)) {
    const net = Number(today.production_wh) - Number(today.consumption_wh);
    const word = net > 0 ? "Superávit" : net < 0 ? "Déficit" : "Equilibrio";
    root.append(h("p", {
      class: "balance-net",
      text: `${word} ${formatEnergyWh(Math.abs(net))} · producción − consumo`,
    }));
  }
}

function timeCategories(points) {
  const seen = new Map();
  const ids = [];
  const shorts = {};
  const titles = {};
  points.forEach((point, index) => {
    const base = formatTime(point.t) || String(index);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    const id = count ? `${base}#${count}` : base;
    ids.push(id);
    shorts[id] = base;
    titles[id] = formatDateTime(point.t);
  });
  return { ids, shorts, titles };
}

function curvePower(points) {
  const hasW = points.some((point) => isNum(point.production_w) || isNum(point.consumption_w));
  if (hasW) {
    return {
      unit: "kW",
      series: [
        { name: "Producción", color: "prod", type: "line", area: true, values: points.map((point) => kwOrNull(point.production_w)) },
        { name: "Consumo", color: "cons", type: "line", area: true, values: points.map((point) => kwOrNull(point.consumption_w)) },
      ],
    };
  }
  return {
    unit: "kWh",
    series: [
      { name: "Producción", color: "prod", type: "line", area: true, values: points.map((point) => kwhOrNull(point.production_wh)) },
      { name: "Consumo", color: "cons", type: "line", area: true, values: points.map((point) => kwhOrNull(point.consumption_wh)) },
    ],
  };
}

function paintCurve(el, points, { slider, ariaLabel }) {
  const power = curvePower(points);
  const categories = timeCategories(points);
  const series = power.series.filter((entry) => alive(entry.values));
  el.hidden = series.length === 0;
  if (!series.length || !window.echarts) return false;
  setChart(el, {
    ...categories,
    series,
    unit: power.unit,
    slider,
    inside: true,
    hourly: true,
    pointer: "line",
    ariaLabel,
  });
  return true;
}

function renderHoy() {
  const today = state.indexed.today || {};
  const day = today.date ? state.indexed.byDate.get(today.date) : null;
  const av = availability();
  document.getElementById("hoy-date").textContent = today.date ? formatDayLong(today.date) : "Sin dato";
  const chips = document.getElementById("hoy-chips");
  chips.replaceChildren();
  if (day?.partial) chips.append(badge("parcial"));
  if (today.status && today.status !== "normal") chips.append(badge(String(today.status)));
  renderBalance(today);
  const note = [];
  if (day?.partial) {
    const end = today.last_interval_end || today.last_report_at;
    note.push(end ? `Día parcial, hasta ${formatTime(end)}.` : "Día parcial.");
  }
  document.getElementById("hoy-note").textContent = note.join(" ");
  const updated = dateTimeParts(today.last_report_at || today.last_interval_end);
  document.getElementById("hoy-cards").replaceChildren(
    metricCard({ kind: "production", label: "Producción", parts: energyParts(today.production_wh), calc: isCalculated("production", day, av) }),
    metricCard({ kind: "consumption", label: "Consumo", parts: energyParts(today.consumption_wh), calc: isCalculated("consumption", day, av) }),
    metricCard({ kind: "import", label: "Importación", parts: energyParts(today.import_wh), calc: isCalculated("import", day, av) }),
    metricCard({ kind: "export", label: "Exportación", parts: energyParts(today.export_wh), calc: isCalculated("export", day, av) }),
    metricCard({
      kind: "self",
      label: "Autoconsumo",
      parts: pctParts(day?.self_consumption_pct),
      calc: isCalculated("self_consumption", day, av),
      hint: "Parte de la producción usada en casa",
    }),
    metricCard({
      kind: "suff",
      label: "Autosuficiencia",
      parts: pctParts(day?.self_sufficiency_pct),
      calc: isCalculated("self_sufficiency", day, av),
      hint: "Parte del consumo cubierta por el sol",
    }),
    metricCard({ kind: "power", label: "Potencia ahora", parts: powerParts(today.current_power_w), calc: false }),
    metricCard({
      kind: "updated",
      label: "Actualización",
      parts: updated.missing ? updated : { ...updated, stacked: true },
      calc: false,
    }),
  );

  const pack = today.date ? state.indexed.intraday[today.date] : null;
  const points = pack?.points || [];
  const empty = document.getElementById("hoy-chart-empty");
  const chart = document.getElementById("chart-hoy");
  const open = document.getElementById("hoy-open-curve");
  const reset = document.getElementById("hoy-curve-reset");
  const hasCurve = points.length > 0;
  empty.hidden = hasCurve;
  open.hidden = !hasCurve;
  reset.hidden = points.length <= 8;
  if (!hasCurve) {
    chart.hidden = true;
    return;
  }
  const painted = paintCurve(chart, points, { slider: false, ariaLabel: `Curva de potencia del ${formatDayLong(today.date)}` });
  empty.hidden = painted;
  if (!painted) chart.hidden = true;
}

function fillCurveSelect(selected) {
  const select = document.getElementById("curve-day");
  select.replaceChildren();
  const dates = [...state.indexed.intradayDates].reverse();
  for (const date of dates) {
    const option = document.createElement("option");
    option.value = date;
    const partial = state.indexed.byDate.get(date)?.partial;
    option.textContent = partial ? `${formatDayMedium(date)} (parcial)` : formatDayMedium(date);
    select.append(option);
  }
  if (selected) select.value = selected;
}

function renderCurva() {
  const dates = state.indexed.intradayDates;
  if (!dates.includes(state.curveDate)) state.curveDate = dates.length ? dates[dates.length - 1] : null;
  const date = state.curveDate;
  fillCurveSelect(date);
  const index = dates.indexOf(date);
  document.getElementById("curve-prev").disabled = index <= 0;
  document.getElementById("curve-next").disabled = index < 0 || index >= dates.length - 1;
  document.getElementById("curve-label").textContent = date ? formatDayLong(date) : "Sin dato";
  const pack = date ? state.indexed.intraday[date] : null;
  const points = pack?.points || [];
  const empty = points.length === 0;
  document.getElementById("curve-empty").hidden = !empty;
  document.getElementById("chart-curve").hidden = empty;
  document.getElementById("curve-reset").hidden = points.length <= 8;
  const day = date ? state.indexed.byDate.get(date) : null;
  const note = [];
  if (day?.partial) {
    const end = state.indexed.today?.date === date
      ? (state.indexed.today.last_interval_end || state.indexed.today.last_report_at)
      : null;
    note.push(end ? `Día parcial, hasta ${formatTime(end)}.` : "Día parcial.");
  }
  const showFlow = points.some((point) => isNum(point.import_wh) || isNum(point.export_wh));
  document.getElementById("curve-note").textContent = note.join(" ");
  document.getElementById("curve-grid-panel").hidden = empty || !showFlow;
  if (empty) return;
  paintCurve(document.getElementById("chart-curve"), points, {
    slider: true,
    ariaLabel: `Curva de potencia del ${formatDayLong(date)}`,
  });
  if (showFlow) {
    const categories = timeCategories(points);
    setChart(document.getElementById("chart-curve-grid"), {
      ...categories,
      unit: "kWh",
      slider: true,
      inside: true,
      hourly: true,
      pointer: "shadow",
      ariaLabel: `Importación y exportación calculadas del ${formatDayLong(date)}`,
      series: [
        { name: "Importación", color: "imp", type: "bar", values: points.map((point) => kwhOrNull(point.import_wh)) },
        { name: "Exportación", color: "exp", type: "bar", values: points.map((point) => kwhOrNull(point.export_wh)) },
      ].filter((entry) => alive(entry.values)),
    });
  }
}

function categoryConfig(items, grain) {
  const ids = items.map((item) => periodId(grain, item));
  const shorts = {};
  const titles = {};
  for (const item of items) {
    const id = periodId(grain, item);
    shorts[id] = formatAxisLabel(grain, item);
    const title = formatPeriod(grain, item);
    titles[id] = isIncomplete(grain, item) ? `${title} (parcial)` : title;
  }
  return { ids, shorts, titles };
}

function whSeries(items, grain, kind, name, color, field) {
  const av = availability();
  return {
    name,
    color,
    type: "bar",
    values: items.map((item) => kwhOrNull(item[field])),
    notes: items.map((item) => (isCalculated(kind, grain === "day" ? item : null, av) ? "calculado" : "")),
    faded: items.map((item) => isIncomplete(grain, item)),
  };
}

function missingText(element, series) {
  const missing = series.filter((entry) => !alive(entry.values)).map((entry) => entry.name);
  element.textContent = missing.length ? `${missing.join(" y ")}: sin dato.` : "";
}

function paintBars(el, items, grain, series, selectedId, onSelect, ariaLabel) {
  const plotted = series.filter((entry) => alive(entry.values));
  el.hidden = plotted.length === 0;
  if (!plotted.length || !window.echarts) return false;
  setChart(el, {
    ...categoryConfig(items, grain),
    series: plotted,
    selectedId,
    onSelect,
    unit: "kWh",
    slider: true,
    inside: true,
    pointer: "shadow",
    ariaLabel,
  });
  return true;
}

function valueCell(text, calc) {
  const td = h("td", { class: "num" }, [document.createTextNode(text)]);
  if (calc) td.append(badge("calculado"));
  return td;
}

function renderTable(table, grain, items, selectedId, columns) {
  const av = availability();
  table.replaceChildren();
  const caption = document.createElement("caption");
  caption.className = "sr-only";
  caption.textContent = table.dataset.caption || "Tabla";
  table.append(caption);
  const head = document.createElement("tr");
  head.append(h("th", { scope: "col", text: "Periodo" }));
  for (const column of columns) {
    const th = h("th", { scope: "col", text: column.label });
    if (column.title) th.title = column.title;
    head.append(th);
  }
  const thead = document.createElement("thead");
  thead.append(head);
  const tbody = document.createElement("tbody");
  let selectedRow = null;
  for (const item of items) {
    const id = periodId(grain, item);
    const tr = document.createElement("tr");
    tr.dataset.id = id;
    tr.tabIndex = 0;
    if (id === selectedId) {
      tr.className = "selected";
      tr.setAttribute("aria-selected", "true");
      selectedRow = tr;
    }
    const label = h("th", { scope: "row", text: formatAxisLabel(grain, item) });
    if (isIncomplete(grain, item)) label.append(badge("parcial"));
    tr.append(label);
    for (const column of columns) {
      const calc = column.kind ? isCalculated(column.kind, grain === "day" ? item : null, av) : false;
      tr.append(valueCell(column.render(item), calc));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const wrap = table.closest(".table-wrap");
  if (selectedRow && wrap) {
    const rowBox = selectedRow.getBoundingClientRect();
    const wrapBox = wrap.getBoundingClientRect();
    if (rowBox.top < wrapBox.top || rowBox.bottom > wrapBox.bottom) {
      wrap.scrollTop += rowBox.top - wrapBox.top - 36;
    }
  }
}

const ENERGY_COLUMNS = [
  { label: "Producción", kind: "production", render: (item) => formatEnergyWh(item.production_wh) },
  { label: "Consumo", kind: "consumption", render: (item) => formatEnergyWh(item.consumption_wh) },
  { label: "Importación", kind: "import", render: (item) => formatEnergyWh(item.import_wh) },
  { label: "Exportación", kind: "export", render: (item) => formatEnergyWh(item.export_wh) },
  { label: "Autoconsumo", kind: "self_consumption", render: (item) => formatPct(item.self_consumption_pct) },
  { label: "Autosuficiencia", kind: "self_sufficiency", render: (item) => formatPct(item.self_sufficiency_pct) },
];

const GRID_COLUMNS = [
  { label: "Importación", kind: "import", render: (item) => formatEnergyWh(item.import_wh) },
  { label: "Exportación", kind: "export", render: (item) => formatEnergyWh(item.export_wh) },
  {
    label: "Balance",
    title: "Exportación menos importación",
    render: (item) => {
      const net = netWh(item);
      if (net == null) return "sin dato";
      const word = net > 0 ? "vertido" : net < 0 ? "compra" : "equilibrio";
      return `${word} ${formatEnergyWh(Math.abs(net))}`;
    },
  },
];

function syncGrain(group, grain) {
  document.querySelectorAll(`[data-grain-group="${group}"]`).forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.grain === grain ? "true" : "false");
  });
}

function syncPager(prefix, grain, id) {
  const item = findItem(state.indexed, grain, id);
  document.getElementById(`${prefix}-label`).textContent = item ? formatPeriodCompact(grain, item) : "Sin dato";
  document.getElementById(`${prefix}-prev`).disabled = !neighborId(state.indexed, grain, id, -1);
  document.getElementById(`${prefix}-next`).disabled = !neighborId(state.indexed, grain, id, 1);
}

function renderPeriodDetail(item, grain) {
  const root = document.getElementById("period-detail");
  root.replaceChildren();
  if (!item) {
    root.append(h("p", { class: "note", text: "Sin dato" }));
    return;
  }
  const meta = [];
  if (grain === "day") meta.push(formatDayLong(item.date));
  if (grain === "week" && item.start && item.end) meta.push(`${formatDayMedium(item.start)} – ${formatDayMedium(item.end)}`);
  if (grain !== "day" && isNum(item.days)) meta.push(`${formatInt(item.days)} días`);
  if (isIncomplete(grain, item)) meta.push("parcial");
  root.append(h("p", { class: "context", text: meta.join(" · ") }));
  const stats = document.createElement("div");
  stats.className = "stats";
  root.append(stats);
  renderStats(stats, detailEntries(item, grain));
}

function renderPeriodos() {
  state.period.id = ensureId(state.indexed, state.period.grain, state.period.id);
  const { grain, id } = state.period;
  syncGrain("period", grain);
  syncPager("period", grain, id);
  document.getElementById("period-context").textContent = contextBlurb(grain, id);
  const item = findItem(state.indexed, grain, id);
  renderPeriodDetail(item, grain);
  const items = contextItems(state.indexed, grain, id);
  const energy = [
    whSeries(items, grain, "production", "Producción", "prod", "production_wh"),
    whSeries(items, grain, "consumption", "Consumo", "cons", "consumption_wh"),
  ];
  const flows = [
    whSeries(items, grain, "import", "Importación", "imp", "import_wh"),
    whSeries(items, grain, "export", "Exportación", "exp", "export_wh"),
  ];
  missingText(document.getElementById("period-energy-missing"), energy);
  missingText(document.getElementById("period-grid-missing"), flows);
  const energyOk = paintBars(
    document.getElementById("chart-period-energy"),
    items,
    grain,
    energy,
    id,
    (next) => { state.period.id = next; renderPeriodos(); },
    `Producción y consumo, ${contextBlurb(grain, id)}`,
  );
  const gridOk = paintBars(
    document.getElementById("chart-period-grid"),
    items,
    grain,
    flows,
    id,
    (next) => { state.period.id = next; renderPeriodos(); },
    `Importación y exportación, ${contextBlurb(grain, id)}`,
  );
  document.getElementById("period-energy-empty").hidden = energyOk;
  document.getElementById("period-grid-empty").hidden = gridOk;
  document.getElementById("period-reset").hidden = items.length <= 8;
  renderTable(document.getElementById("period-table"), grain, items, id, ENERGY_COLUMNS);
}

function renderGrid() {
  state.grid.id = ensureId(state.indexed, state.grid.grain, state.grid.id);
  const { grain, id } = state.grid;
  syncGrain("grid", grain);
  syncPager("grid", grain, id);
  document.getElementById("grid-context").textContent = contextBlurb(grain, id);
  const item = findItem(state.indexed, grain, id);
  renderStats(document.getElementById("grid-summary"), item ? gridEntries(item, grain) : []);
  const items = contextItems(state.indexed, grain, id);
  const flows = [
    whSeries(items, grain, "import", "Importación", "imp", "import_wh"),
    whSeries(items, grain, "export", "Exportación", "exp", "export_wh"),
    {
      name: "Balance",
      color: "balance",
      type: "line",
      values: items.map((entry) => {
        const net = netWh(entry);
        return net == null ? null : net / 1000;
      }),
    },
  ];
  const bits = ["La línea de balance es exportación menos importación."];
  if (hasDerivedImport(state.indexed, grain, items)) bits.push("Hay valores marcados como calculados.");
  document.getElementById("grid-note").textContent = bits.join(" ");
  const ok = paintBars(
    document.getElementById("chart-grid"),
    items,
    grain,
    flows,
    id,
    (next) => { state.grid.id = next; renderGrid(); },
    `Balance de red, ${contextBlurb(grain, id)}`,
  );
  document.getElementById("grid-empty").hidden = ok;
  document.getElementById("grid-reset").hidden = items.length <= 8;
  renderTable(document.getElementById("grid-table"), grain, items, id, GRID_COLUMNS);
}

function gridEntries(item, grain) {
  const av = availability();
  const day = grain === "day" ? item : null;
  const balance = balanceEntry(item);
  return [
    ["Importación", energyParts(item?.import_wh), isCalculated("import", day, av)],
    ["Exportación", energyParts(item?.export_wh), isCalculated("export", day, av)],
    ["Balance de red", balance.parts, false, balance.hint],
  ];
}

function groupKeyOf(grain, id) {
  if (grain === "day") return id.slice(0, 7);
  if (grain === "week" || grain === "month") return id.slice(0, 4);
  return "";
}

function fillPeriodSelect(select, grain, selected) {
  const list = periodList(state.indexed, grain);
  select.replaceChildren();
  let groupEl = null;
  let current = null;
  for (const item of list) {
    const id = periodId(grain, item);
    const group = groupKeyOf(grain, id);
    if (group !== current) {
      current = group;
      if (group) {
        groupEl = document.createElement("optgroup");
        groupEl.label = grain === "day" ? formatMonthKey(group) : group;
        select.append(groupEl);
      } else {
        groupEl = null;
      }
    }
    const option = document.createElement("option");
    option.value = id;
    option.textContent = formatPeriod(grain, item);
    (groupEl || select).append(option);
  }
  if (selected) select.value = selected;
}

function setCompareNote(text) {
  const note = document.getElementById("compare-note");
  note.textContent = text || "";
  note.hidden = !text;
}

function renderCompare() {
  const grain = state.compare.grain;
  state.compare.a = ensureId(state.indexed, grain, state.compare.a);
  if (state.compare.b && !findItem(state.indexed, grain, state.compare.b)) {
    state.compare.b = neighborId(state.indexed, grain, state.compare.a, -1);
  }
  syncGrain("compare", grain);
  fillPeriodSelect(document.getElementById("compare-a"), grain, state.compare.a);
  fillPeriodSelect(document.getElementById("compare-b"), grain, state.compare.b);
  const aItem = findItem(state.indexed, grain, state.compare.a);
  const bItem = findItem(state.indexed, grain, state.compare.b);
  const nameA = aItem ? formatPeriod(grain, aItem) : "Sin dato";
  const nameB = bItem ? formatPeriod(grain, bItem) : "Sin dato";
  const legend = document.getElementById("compare-legend");
  legend.replaceChildren(
    h("span", { class: "key" }, [h("i", { class: "swatch prod", "aria-hidden": "true" }), nameA]),
    h("span", { class: "key" }, [h("i", { class: "swatch cons", "aria-hidden": "true" }), nameB]),
  );
  const av = availability();
  const rows = [
    { label: "Producción", field: "production_wh", format: formatEnergyWh, chart: true },
    { label: "Consumo", field: "consumption_wh", format: formatEnergyWh, chart: true },
    { label: "Importación", field: "import_wh", format: formatEnergyWh, chart: true, kind: "import" },
    { label: "Exportación", field: "export_wh", format: formatEnergyWh, chart: true, kind: "export" },
    { label: "Autoconsumo", field: "self_consumption_pct", format: formatPct, kind: "self_consumption" },
    { label: "Autosuficiencia", field: "self_sufficiency_pct", format: formatPct, kind: "self_sufficiency" },
  ];
  const metrics = document.getElementById("compare-metrics");
  metrics.replaceChildren();
  for (const row of rows) {
    const aVal = aItem ? aItem[row.field] : null;
    const bVal = bItem ? bItem[row.field] : null;
    const calc = row.kind && (
      isCalculated(row.kind, grain === "day" ? aItem : null, av)
      || isCalculated(row.kind, grain === "day" ? bItem : null, av)
    );
    const title = h("h3", {}, [document.createTextNode(row.label)]);
    if (calc) title.append(badge("calculado"));
    metrics.append(h("article", { class: "cmp-card" }, [
      title,
      h("div", { class: "cmp-line" }, [h("span", { class: "k", text: nameA }), h("b", { text: row.format(aVal) })]),
      h("div", { class: "cmp-line" }, [h("span", { class: "k", text: nameB }), h("b", { text: row.format(bVal) })]),
      h("div", { class: "cmp-line" }, [h("span", { class: "k", text: "Diferencia" }), h("b", { text: formatDelta(aVal, bVal) })]),
    ]));
  }
  const balanceA = netWh(aItem);
  const balanceB = netWh(bItem);
  metrics.append(h("article", { class: "cmp-card" }, [
    h("h3", { text: "Balance de red" }),
    h("div", { class: "cmp-line" }, [h("span", { class: "k", text: nameA }), h("b", { text: balanceText(balanceA) })]),
    h("div", { class: "cmp-line" }, [h("span", { class: "k", text: nameB }), h("b", { text: balanceText(balanceB) })]),
    h("div", { class: "cmp-line" }, [h("span", { class: "k", text: "Diferencia" }), h("b", { text: formatDelta(balanceA, balanceB) })]),
    h("small", { class: "hint", text: "Exportación menos importación" }),
  ]));

  const chartRows = rows.filter((row) => row.chart);
  const ids = chartRows.map((row) => row.field);
  const shorts = {};
  const titles = {};
  chartRows.forEach((row) => {
    shorts[row.field] = row.label;
    titles[row.field] = row.label;
  });
  const series = [
    { name: aItem ? formatPeriodCompact(grain, aItem) : "Periodo A", color: "a", values: chartRows.map((row) => kwhOrNull(aItem?.[row.field])) },
    { name: bItem ? formatPeriodCompact(grain, bItem) : "Periodo B", color: "b", values: chartRows.map((row) => kwhOrNull(bItem?.[row.field])) },
  ].filter((entry) => alive(entry.values));
  const chart = document.getElementById("chart-compare");
  const empty = document.getElementById("compare-empty");
  if (!series.length || !window.echarts) {
    chart.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  chart.hidden = false;
  setChart(chart, {
    ids,
    shorts,
    titles,
    series,
    unit: "kWh",
    slider: false,
    inside: false,
    pointer: "shadow",
    ariaLabel: `Comparación de ${nameA} y ${nameB}`,
  });
}

function balanceText(net) {
  if (net == null) return "sin dato";
  const word = net > 0 ? "vertido" : net < 0 ? "compra" : "equilibrio";
  return `${word} ${formatEnergyWh(Math.abs(net))}`;
}

function recordCard(label, value, sub, jump) {
  const attrs = { class: jump ? "record" : "record static" };
  if (jump) {
    attrs.type = "button";
    attrs["data-jump"] = jump;
  }
  return h(jump ? "button" : "div", attrs, [
    h("span", { class: "k", text: label }),
    h("strong", { text: value }),
    sub ? h("span", { class: "sub", text: sub }) : null,
  ]);
}

function jumpId(grain, id) {
  if (!id || !findItem(state.indexed, grain, id)) return null;
  return `${grain}|${id}`;
}

function renderRecords() {
  const rec = state.indexed.records || {};
  const meta = state.indexed.meta || {};
  const root = document.getElementById("records-root");
  const bestDay = rec.best_production_day;
  const worstDay = rec.worst_production_day;
  const bestWeek = rec.best_production_week;
  const weekItem = bestWeek ? findItem(state.indexed, "week", bestWeek.key) : null;
  const bestMonth = rec.best_production_month;
  const bestYear = rec.best_production_year;
  const highUse = rec.highest_consumption_day;
  const peak = rec.peak_15min_power_last_days;
  const peakDate = typeof peak?.t === "string" ? peak.t.slice(0, 10) : null;
  const peakJump = peakDate && state.indexed.intradayDates.includes(peakDate)
    ? `curve|${peakDate}`
    : jumpId("day", peakDate);
  let lifeSub = "Total oficial";
  if (isNum(meta.lifetime_production_wh) && isNum(meta.lifetime_production_wh_sum_of_daily)
    && Number(meta.lifetime_production_wh) !== Number(meta.lifetime_production_wh_sum_of_daily)) {
    lifeSub = `Suma de días ${formatEnergyWh(meta.lifetime_production_wh_sum_of_daily)}`;
  }
  root.replaceChildren(
    recordCard("Mejor día", bestDay ? formatEnergyWh(bestDay.production_wh) : "sin dato", bestDay ? formatDayLong(bestDay.date) : "", jumpId("day", bestDay?.date)),
    recordCard("Peor día", worstDay ? formatEnergyWh(worstDay.production_wh) : "sin dato", worstDay ? formatDayLong(worstDay.date) : "", jumpId("day", worstDay?.date)),
    recordCard("Mejor semana", bestWeek ? formatEnergyWh(bestWeek.production_wh) : "sin dato", weekItem ? formatPeriod("week", weekItem) : (bestWeek?.key || ""), jumpId("week", bestWeek?.key)),
    recordCard("Mejor mes", bestMonth ? formatEnergyWh(bestMonth.production_wh) : "sin dato", bestMonth?.key ? formatMonthKey(bestMonth.key) : "", jumpId("month", bestMonth?.key)),
    recordCard("Mejor año", bestYear ? formatEnergyWh(bestYear.production_wh) : "sin dato", bestYear ? `${bestYear.key}${isNum(bestYear.days) ? ` · ${formatInt(bestYear.days)} días` : ""}` : "", jumpId("year", bestYear?.key)),
    recordCard("Mayor consumo", highUse ? formatEnergyWh(highUse.consumption_wh) : "sin dato", highUse ? formatDayLong(highUse.date) : "", jumpId("day", highUse?.date)),
    recordCard("Pico de potencia", peak ? formatPowerW(peak.power_w) : "sin dato", peak?.t ? formatDateTime(peak.t) : "", peakJump),
    recordCard("Media diaria", formatEnergyWh(rec.avg_daily_production_wh), "Producción", null),
    recordCard("Días con datos", isNum(rec.days_with_data) ? formatInt(rec.days_with_data) : "sin dato", "", null),
    recordCard("Producción acumulada", formatEnergyWh(meta.lifetime_production_wh), lifeSub, null),
  );
}

function renderChrome() {
  const meta = state.indexed.meta || {};
  const sys = meta.system || {};
  const bits = [];
  if (sys.location) bits.push(sys.location);
  if (isNum(sys.size_w)) bits.push(formatPowerW(sys.size_w));
  if (isNum(sys.modules)) bits.push(`${formatInt(sys.modules)} módulos`);
  const battery = batteryLabel(meta);
  if (battery) bits.push(battery);
  document.getElementById("system-line").textContent = bits.join(" · ");
  document.getElementById("demo-banner").hidden = !meta.demo;
  document.getElementById("footer-updated").textContent = meta.generated_at
    ? `Actualizado ${formatDateTime(meta.generated_at)}`
    : "Sin fecha de actualización";
  const extra = [];
  if (sys.operational_date) extra.push(`En servicio desde ${formatDayLong(sys.operational_date)}`);
  if (sys.inverters) extra.push(String(sys.inverters));
  if (meta.data_range?.first_date && meta.data_range?.last_date) {
    extra.push(`Rango ${formatDayMedium(meta.data_range.first_date)} – ${formatDayMedium(meta.data_range.last_date)}`);
  }
  document.getElementById("system-extra").textContent = extra.join(" · ");
  const notes = document.getElementById("notes-list");
  notes.replaceChildren();
  for (const note of meta.notes || []) {
    const li = document.createElement("li");
    li.textContent = String(note);
    notes.append(li);
  }
}

function renderView(name) {
  if (!state.indexed) return;
  if (name === "hoy") renderHoy();
  else if (name === "curva") renderCurva();
  else if (name === "periodos") renderPeriodos();
  else if (name === "comparar") renderCompare();
  else if (name === "red") renderGrid();
  else if (name === "records") renderRecords();
}

function showView(name, { updateHash = true, replace = false } = {}) {
  if (!VIEWS.some(([id]) => id === name)) name = "hoy";
  state.view = name;
  for (const [id] of VIEWS) {
    document.getElementById(`view-${id}`).hidden = id !== name;
  }
  document.querySelectorAll("[data-view]").forEach((button) => {
    const on = button.dataset.view === name;
    button.setAttribute("aria-selected", on ? "true" : "false");
    button.tabIndex = on ? 0 : -1;
  });
  document.title = `Solar · ${labelOf(name)}`;
  if (updateHash && location.hash !== `#${name}`) {
    const next = `${location.pathname}${location.search}#${name}`;
    history[replace ? "replaceState" : "pushState"](null, "", next);
  }
  renderView(name);
  requestAnimationFrame(() => resizeCharts());
}

function initSelection() {
  const indexed = state.indexed;
  state.period = { grain: "day", id: latestId(indexed, "day") };
  state.grid = { grain: "day", id: latestId(indexed, "day") };
  const grain = "month";
  const a = latestId(indexed, grain);
  let b = samePeriodLastYear(grain, a);
  if (!findItem(indexed, grain, b)) b = neighborId(indexed, grain, a, -1);
  state.compare = { grain, a, b };
  state.curveDate = indexed.intradayDates.length ? indexed.intradayDates[indexed.intradayDates.length - 1] : null;
}

function enterApp() {
  document.getElementById("password").value = "";
  document.getElementById("login").hidden = true;
  document.getElementById("app").hidden = false;
  initSelection();
  renderChrome();
  syncThemeButton();
  showView(viewFromHash() || "hoy", { replace: true });
  document.getElementById("app-title").focus({ preventScroll: true });
}

function logout() {
  clearDerivedKey(state.dataset);
  disposeCharts();
  state.indexed = null;
  document.getElementById("password").value = "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  showLogin("");
}

async function loadEnvelope() {
  const response = await fetch(state.url, { cache: "no-store" });
  if (!response.ok) throw new Error("http");
  return response.json();
}

function envelopeOk(envelope) {
  return Boolean(envelope && envelope.salt_b64 && envelope.iv_b64 && envelope.ct_b64 && Number.isInteger(envelope.iter));
}

async function boot() {
  bind();
  syncThemeButton();
  const params = new URLSearchParams(location.search);
  state.dataset = params.get("demo") === "1" ? "demo" : "solar";
  state.url = state.dataset === "demo" ? "data/demo.enc.json" : "data/solar.enc.json";
  showLogin("Cargando…", { busy: true, busyLabel: "Cargando…" });
  try {
    state.envelope = await loadEnvelope();
  } catch {
    showLogin("No se pudieron descargar los datos.", { error: true });
    return;
  }
  if (!envelopeOk(state.envelope)) {
    showLogin("El archivo de datos no tiene el formato esperado.", { error: true });
    return;
  }
  const saved = readDerivedKey(state.dataset);
  if (saved && saved.salt_b64 === state.envelope.salt_b64) {
    showLogin("Abriendo datos…", { busy: true, busyLabel: "Abriendo…" });
    try {
      const key = await importStoredKey(saved.key_b64);
      state.indexed = indexData(await decryptWithKey(state.envelope, key));
      enterApp();
      return;
    } catch {
      clearDerivedKey(state.dataset);
    }
  }
  if (saved && saved.salt_b64 !== state.envelope.salt_b64) {
    clearDerivedKey(state.dataset);
    showLogin("Los datos se actualizaron. Ingresá la contraseña de nuevo.");
    return;
  }
  showLogin("");
}

async function onLogin(event) {
  event.preventDefault();
  const input = document.getElementById("password");
  const password = input.value;
  const remember = document.getElementById("remember").checked;
  if (!password) {
    showLogin("Ingresá la contraseña.", { error: true });
    return;
  }
  if (!state.envelope) {
    showLogin("No se pudieron descargar los datos.", { error: true });
    return;
  }
  showLogin("Descifrando…", { busy: true, busyLabel: "Descifrando…" });
  try {
    const { data, key } = await decryptWithPassword(state.envelope, password, { extractable: remember });
    if (remember) {
      try {
        const raw = await crypto.subtle.exportKey("raw", key);
        writeDerivedKey(state.dataset, state.envelope.salt_b64, bytesToB64(new Uint8Array(raw)));
      } catch {
        clearDerivedKey(state.dataset);
      }
    } else {
      clearDerivedKey(state.dataset);
    }
    state.indexed = indexData(data);
    enterApp();
  } catch (error) {
    input.value = password;
    const message = error && error.code === "parse"
      ? "No se pudieron leer los datos."
      : error && error.code === "format"
        ? "El archivo de datos no tiene el formato esperado."
        : "Esa contraseña no abre los datos. Probá de nuevo.";
    showLogin(message, { error: true });
  }
}

function stepCurve(direction) {
  const dates = state.indexed.intradayDates;
  const next = dates[dates.indexOf(state.curveDate) + direction];
  if (!next) return;
  state.curveDate = next;
  renderCurva();
}

function stepBucket(group, direction) {
  const bucket = state[group];
  const next = neighborId(state.indexed, bucket.grain, bucket.id, direction);
  if (!next) return;
  bucket.id = next;
  renderView(state.view);
}

function setGrain(group, grain) {
  if (group === "compare") {
    const a = latestId(state.indexed, grain);
    let b = samePeriodLastYear(grain, a);
    if (!findItem(state.indexed, grain, b)) b = neighborId(state.indexed, grain, a, -1);
    state.compare = { grain, a, b };
    setCompareNote("");
  } else {
    const bucket = state[group];
    bucket.id = translateId(state.indexed, bucket.grain, bucket.id, grain);
    bucket.grain = grain;
  }
  renderView(state.view);
}

function presetYearAgo() {
  const id = samePeriodLastYear(state.compare.grain, state.compare.a);
  if (!findItem(state.indexed, state.compare.grain, id)) {
    setCompareNote("No hay el mismo periodo del año anterior.");
    return;
  }
  state.compare.b = id;
  setCompareNote("");
  renderCompare();
}

function presetPrevious() {
  const id = neighborId(state.indexed, state.compare.grain, state.compare.a, -1);
  if (!id) {
    setCompareNote("No hay un periodo anterior.");
    return;
  }
  state.compare.b = id;
  setCompareNote("");
  renderCompare();
}

function jump(spec) {
  const split = spec.indexOf("|");
  if (split < 0) return;
  const kind = spec.slice(0, split);
  const id = spec.slice(split + 1);
  if (kind === "curve") {
    if (state.indexed.intradayDates.includes(id)) {
      state.curveDate = id;
      showView("curva");
    }
    return;
  }
  if (!findItem(state.indexed, kind, id)) return;
  state.period.grain = kind;
  state.period.id = id;
  showView("periodos");
}

function onTableActivate(tableId, group, event) {
  const row = event.target.closest("tr[data-id]");
  if (!row || !event.currentTarget.contains(row)) return;
  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
  if (event.type === "keydown") event.preventDefault();
  state[group].id = row.dataset.id;
  renderView(state.view);
}

function bind() {
  if (bound) return;
  bound = true;
  document.getElementById("login-form").addEventListener("submit", onLogin);
  document.getElementById("toggle-password").addEventListener("click", () => {
    const input = document.getElementById("password");
    const button = document.getElementById("toggle-password");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    button.setAttribute("aria-pressed", show ? "true" : "false");
  });
  document.getElementById("logout").addEventListener("click", logout);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* almacenamiento bloqueado */ }
    syncThemeButton();
    if (state.indexed) renderView(state.view);
  });
  const tabs = document.querySelector(".tabs");
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    showView(button.dataset.view);
  });
  tabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const buttons = [...tabs.querySelectorAll("[role=tab]")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = buttons[(index + direction + buttons.length) % buttons.length];
    next.focus();
    showView(next.dataset.view);
  });
  document.getElementById("curve-prev").addEventListener("click", () => stepCurve(-1));
  document.getElementById("curve-next").addEventListener("click", () => stepCurve(1));
  document.getElementById("curve-day").addEventListener("change", (event) => {
    state.curveDate = event.target.value;
    renderCurva();
  });
  document.getElementById("curve-reset").addEventListener("click", () => renderCurva());
  document.getElementById("hoy-curve-reset").addEventListener("click", () => renderHoy());
  document.getElementById("hoy-open-curve").addEventListener("click", () => {
    const date = state.indexed?.today?.date;
    if (date && state.indexed.intradayDates.includes(date)) state.curveDate = date;
    showView("curva");
  });
  document.getElementById("period-prev").addEventListener("click", () => stepBucket("period", -1));
  document.getElementById("period-next").addEventListener("click", () => stepBucket("period", 1));
  document.getElementById("period-reset").addEventListener("click", () => renderPeriodos());
  document.getElementById("grid-prev").addEventListener("click", () => stepBucket("grid", -1));
  document.getElementById("grid-next").addEventListener("click", () => stepBucket("grid", 1));
  document.getElementById("grid-reset").addEventListener("click", () => renderGrid());
  document.querySelectorAll("[data-grain-group]").forEach((button) => {
    button.addEventListener("click", () => setGrain(button.dataset.grainGroup, button.dataset.grain));
  });
  document.getElementById("compare-a").addEventListener("change", (event) => {
    state.compare.a = event.target.value;
    setCompareNote("");
    renderCompare();
  });
  document.getElementById("compare-b").addEventListener("change", (event) => {
    state.compare.b = event.target.value;
    setCompareNote("");
    renderCompare();
  });
  document.getElementById("compare-year").addEventListener("click", presetYearAgo);
  document.getElementById("compare-prev").addEventListener("click", presetPrevious);
  document.getElementById("period-table").addEventListener("click", (event) => onTableActivate("period-table", "period", event));
  document.getElementById("period-table").addEventListener("keydown", (event) => onTableActivate("period-table", "period", event));
  document.getElementById("grid-table").addEventListener("click", (event) => onTableActivate("grid-table", "grid", event));
  document.getElementById("grid-table").addEventListener("keydown", (event) => onTableActivate("grid-table", "grid", event));
  document.getElementById("records-root").addEventListener("click", (event) => {
    const button = event.target.closest("[data-jump]");
    if (button) jump(button.dataset.jump);
  });
  window.addEventListener("popstate", () => {
    if (!state.indexed) return;
    showView(viewFromHash() || "hoy", { updateHash: false });
  });
  window.addEventListener("resize", () => resizeCharts());
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
    if (saved === "light" || saved === "dark") return;
    document.documentElement.setAttribute("data-theme", media.matches ? "dark" : "light");
    syncThemeButton();
    if (state.indexed) renderView(state.view);
  });
}

boot();
