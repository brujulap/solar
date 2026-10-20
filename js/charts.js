import { formatAxis, formatChartValue } from "./format.js";

function tokens() {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    text: read("--text") || "#1c1915",
    muted: read("--muted") || "#5e574e",
    line: read("--line") || "rgba(40,32,20,.12)",
    surface: read("--surface") || "#fffdf9",
    surface2: read("--surface-2") || "#f7f1e7",
    prod: read("--prod") || "#d4890b",
    cons: read("--cons") || "#2f5f98",
    imp: read("--imp") || "#c2593f",
    exp: read("--exp") || "#0e7c6b",
    accent: read("--accent") || "#e09a12",
    gridline: read("--gridline") || "rgba(40,32,20,.08)",
  };
}

function withAlpha(hex, alpha) {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return hex;
  const value = Number.parseInt(raw, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const COLOR_KEYS = {
  prod: "prod",
  cons: "cons",
  imp: "imp",
  exp: "exp",
  a: "prod",
  b: "cons",
  balance: "text",
};

function colorOf(palette, key) {
  if (key === "text" || key === "balance") return palette.text;
  return palette[COLOR_KEYS[key] || key] || palette.prod;
}

function motionOk() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pointValue(row) {
  if (row?.data && typeof row.data === "object" && "value" in row.data) return row.data.value;
  if (Array.isArray(row?.value)) return row.value[row.value.length - 1];
  return row?.value;
}

function mount(el) {
  if (!el || !window.echarts) return null;
  let chart = window.echarts.getInstanceByDom(el);
  if (!chart) chart = window.echarts.init(el, null, { renderer: "canvas" });
  return chart;
}

export function disposeCharts(root = document) {
  if (!window.echarts) return;
  root.querySelectorAll(".chart").forEach((el) => {
    window.echarts.getInstanceByDom(el)?.dispose();
  });
}

export function resizeCharts() {
  if (!window.echarts) return;
  document.querySelectorAll(".chart").forEach((el) => {
    if (el.closest("[hidden]") || el.hidden) return;
    window.echarts.getInstanceByDom(el)?.resize();
  });
}

function zoomParts(palette, count, { slider, inside }) {
  const parts = [];
  if (inside && count > 8) {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    parts.push({
      type: "inside",
      throttle: 40,
      zoomOnMouseWheel: true,
      moveOnMouseMove: !coarse,
      moveOnMouseWheel: true,
      preventDefaultMouseMove: false,
      filterMode: "none",
    });
  }
  if (slider && count > 8) {
    parts.push({
      type: "slider",
      height: 18,
      bottom: 4,
      brushSelect: false,
      borderColor: "transparent",
      backgroundColor: palette.surface2,
      fillerColor: withAlpha(palette.accent, 0.28),
      handleSize: 14,
      handleStyle: { color: palette.accent, borderColor: palette.accent },
      moveHandleSize: 0,
      textStyle: { color: palette.muted, fontSize: 10 },
      dataBackground: {
        lineStyle: { color: palette.prod },
        areaStyle: { color: withAlpha(palette.prod, 0.15) },
      },
      selectedDataBackground: {
        lineStyle: { color: palette.prod },
        areaStyle: { color: withAlpha(palette.prod, 0.25) },
      },
    });
  }
  return parts;
}

export function setChart(el, config) {
  const chart = mount(el);
  if (!chart) return null;
  const palette = tokens();
  const ids = config.ids || [];
  const shorts = config.shorts || {};
  const titles = config.titles || {};
  const series = config.series || [];
  const unit = config.unit || "";
  const zoom = zoomParts(palette, ids.length, {
    slider: config.slider !== false,
    inside: config.inside !== false,
  });
  const showSlider = zoom.some((part) => part.type === "slider");

  chart.setOption({
    animation: motionOk(),
    animationDuration: 350,
    textStyle: { fontFamily: "Segoe UI, system-ui, sans-serif" },
    aria: { enabled: false },
    legend: {
      type: "scroll",
      top: 0,
      right: 0,
      data: series.filter((entry) => !entry.dash).map((entry) => entry.name),
      itemWidth: 12,
      itemHeight: 8,
      icon: "roundRect",
      textStyle: { color: palette.muted, fontSize: 12 },
      pageTextStyle: { color: palette.muted },
    },
    grid: {
      left: 4,
      right: 8,
      top: series.length ? (unit ? 46 : 34) : 22,
      bottom: showSlider ? 32 : 4,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: {
        type: config.pointer || "line",
        label: {
          show: true,
          formatter(params) {
            if (params.axisDimension === "y" && unit) return formatChartValue(params.value, unit);
            const label = shorts[params.value] || params.value;
            return label == null ? "" : String(label);
          },
        },
      },
      backgroundColor: palette.surface,
      borderColor: palette.line,
      textStyle: { color: palette.text, fontSize: 12 },
      extraCssText: "border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);",
      formatter(params) {
        const rows = Array.isArray(params) ? params : [params];
        if (!rows.length) return "";
        const id = rows[0].axisValue;
        const title = titles[id] || shorts[id] || id;
        const chosen = new Map();
        for (const row of rows) {
          const raw = pointValue(row);
          if (raw == null || Number.isNaN(Number(raw)) || !row.seriesName) continue;
          const note = row.data && typeof row.data === "object" ? row.data.note : "";
          const prev = chosen.get(row.seriesName);
          if (!prev || (note && !prev.note)) chosen.set(row.seriesName, { row, raw, note });
        }
        const body = [...chosen.values()].map(({ row, raw, note }) => {
          const suffix = note ? ` (${note})` : "";
          return `${row.marker} ${escapeHtml(row.seriesName)}: ${escapeHtml(formatChartValue(raw, unit))}${escapeHtml(suffix)}`;
        }).join("<br>");
        return `${escapeHtml(title)}<br>${body}`;
      },
    },
    dataZoom: zoom,
    xAxis: {
      type: "category",
      data: ids,
      axisLine: { lineStyle: { color: palette.line } },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: 11,
        hideOverlap: true,
        formatter: (id) => shorts[id] || id,
        interval: config.hourly
          ? (index, value) => String(shorts[value] || value).endsWith(":00") || index === ids.length - 1
          : "auto",
      },
    },
    yAxis: {
      type: "value",
      name: unit || "",
      nameLocation: "end",
      nameGap: 8,
      nameTextStyle: {
        color: palette.muted,
        fontSize: 12,
        fontWeight: 600,
        align: "left",
        padding: [0, 0, 0, 2],
      },
      min: (extent) => Math.min(0, extent.min),
      axisLabel: {
        color: palette.muted,
        fontSize: 11,
        formatter: (value) => formatAxis(value),
      },
      splitLine: { lineStyle: { color: palette.gridline } },
    },
    series: series.map((entry) => {
      const color = colorOf(palette, entry.color);
      const type = entry.type || "bar";
      const data = ids.map((id, index) => {
        const value = entry.values[index];
        const point = {
          value: value == null || Number.isNaN(value) ? null : value,
          note: entry.notes ? entry.notes[index] || "" : "",
        };
        if (type === "bar") {
          point.itemStyle = {
            color,
            borderRadius: [4, 4, 0, 0],
            opacity: entry.faded && entry.faded[index] ? 0.72 : 1,
            borderWidth: config.selectedId && id === config.selectedId ? 1.5 : 0,
            borderColor: palette.text,
          };
        }
        return point;
      });
      const serie = {
        name: entry.name,
        type,
        data,
        itemStyle: { color, opacity: entry.dash ? 0.72 : 1 },
        lineStyle: {
          color,
          width: 2,
          type: entry.dash ? "dashed" : "solid",
        },
        showSymbol: Boolean(entry.dash),
        symbol: "circle",
        symbolSize: entry.dash ? 6 : 7,
        connectNulls: false,
        barMaxWidth: 28,
        emphasis: { focus: "series" },
        z: entry.dash ? 4 : (type === "line" ? 3 : 2),
      };
      if (entry.area && type === "line" && !entry.dash) {
        serie.areaStyle = {
          color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: withAlpha(color, 0.38) },
            { offset: 1, color: withAlpha(color, 0.03) },
          ]),
        };
      }
      return serie;
    }),
  }, { notMerge: true });

  chart.off("click");
  if (config.onSelect) {
    chart.on("click", (params) => {
      if (params && params.dataIndex != null && ids[params.dataIndex]) {
        config.onSelect(ids[params.dataIndex]);
      }
    });
  }
  if (config.ariaLabel) el.setAttribute("aria-label", config.ariaLabel);
  el.setAttribute("role", "img");
  if (el.clientWidth === 0) requestAnimationFrame(() => chart.resize());
  return chart;
}
