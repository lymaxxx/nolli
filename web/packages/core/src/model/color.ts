import type { LayerSnapshot } from './layers';
import type { ProjectSnapshot } from './project';
import type { CodableColor, MapColorScheme } from './styles';

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function byteHex(channel: number): string {
  return Math.round(clampUnit(channel) * 255)
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
}

/** Uppercase 6-digit hex without a leading `#`, matching the colour well in the macOS app. */
export function colorToHex(color: CodableColor): string {
  return `${byteHex(color.r)}${byteHex(color.g)}${byteHex(color.b)}`;
}

/** Parses a 3-digit or 6-digit hex string (with or without `#`), keeping `alpha`. */
export function hexToColor(hex: string, alpha = 1): CodableColor | null {
  let clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((ch) => `${ch}${ch}`)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const value = Number.parseInt(clean, 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
    a: clampUnit(alpha),
  };
}

/** Converts sRGB channels (`0..1`) to HSB (`0..1`). */
export function rgbToHsb(color: CodableColor): { h: number; s: number; b: number } {
  const r = clampUnit(color.r);
  const g = clampUnit(color.g);
  const b = clampUnit(color.b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h /= 6;
    if (h < 0) h += 1;
  }

  const s = max === 0 ? 0 : delta / max;
  return { h, s, b: max };
}

/** Converts HSB (`0..1`) to sRGB (`0..1`). */
export function hsbToRgb(h: number, s: number, b: number, a = 1): CodableColor {
  const hue = (((h % 1) + 1) % 1) * 6;
  const sat = clampUnit(s);
  const bri = clampUnit(b);
  const c = bri * sat;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = bri - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  const sector = Math.floor(hue);
  switch (sector) {
    case 0:
      r1 = c;
      g1 = x;
      break;
    case 1:
      r1 = x;
      g1 = c;
      break;
    case 2:
      g1 = c;
      b1 = x;
      break;
    case 3:
      g1 = x;
      b1 = c;
      break;
    case 4:
      r1 = x;
      b1 = c;
      break;
    default:
      r1 = c;
      b1 = x;
      break;
  }

  return {
    r: clampUnit(r1 + m),
    g: clampUnit(g1 + m),
    b: clampUnit(b1 + m),
    a: clampUnit(a),
  };
}

/** Converts sRGB (`0..1`) to CMYK (`0..1`), matching `ColorPanel.swift`. */
export function rgbToCmyk(color: CodableColor): { c: number; m: number; y: number; k: number } {
  const r = clampUnit(color.r);
  const g = clampUnit(color.g);
  const b = clampUnit(color.b);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  const denom = 1 - k;
  return {
    c: clampUnit((1 - r - k) / denom),
    m: clampUnit((1 - g - k) / denom),
    y: clampUnit((1 - b - k) / denom),
    k: clampUnit(k),
  };
}

/** Converts CMYK (`0..1`) to sRGB (`0..1`). */
export function cmykToRgb(c: number, m: number, y: number, k: number, a = 1): CodableColor {
  const cClamped = clampUnit(c);
  const mClamped = clampUnit(m);
  const yClamped = clampUnit(y);
  const kClamped = clampUnit(k);
  return {
    r: (1 - cClamped) * (1 - kClamped),
    g: (1 - mClamped) * (1 - kClamped),
    b: (1 - yClamped) * (1 - kClamped),
    a: clampUnit(a),
  };
}

export function sameColor(a: CodableColor, b: CodableColor, epsilon = 0.003): boolean {
  return (
    Math.abs(a.r - b.r) < epsilon &&
    Math.abs(a.g - b.g) < epsilon &&
    Math.abs(a.b - b.b) < epsilon &&
    Math.abs(a.a - b.a) < epsilon
  );
}

const DEFAULT_ARTBOARD_BACKGROUND: CodableColor = {
  r: 0.973,
  g: 0.961,
  b: 0.941,
  a: 1,
};

/** Captures every colour slot of a project into a named scheme, ported from `AppState.captureColorScheme`. */
export function captureColorScheme(
  project: ProjectSnapshot,
  name: string,
  id = '00000000-0000-4000-8000-000000000000',
): MapColorScheme {
  const colors: Record<string, CodableColor> = {
    'frame|background': project.artboardBackground ?? DEFAULT_ARTBOARD_BACKGROUND,
  };
  for (const layer of project.layers) {
    const base = `${layer.kind}|${layer.name}`;
    colors[`${base}|road.color`] = layer.roadStyle.color;
    colors[`${base}|road.casing`] = layer.roadStyle.casingColor;
    colors[`${base}|area.fill`] = layer.areaStyle.fillColor;
    colors[`${base}|area.stroke`] = layer.areaStyle.strokeColor;
    colors[`${base}|poi.fill`] = layer.poiStyle.fillColor;
    colors[`${base}|poi.stroke`] = layer.poiStyle.strokeColor;
    colors[`${base}|label.color`] = layer.labelStyle.color;
    colors[`${base}|label.halo`] = layer.labelStyle.haloColor;
    for (const sub of layer.roadSubLayers) {
      const sb = `${base}|sub:${sub.name}`;
      colors[`${sb}|road.color`] = sub.customStyle.color;
      colors[`${sb}|road.casing`] = sub.customStyle.casingColor;
      if (sub.labelStyle) {
        colors[`${sb}|label.color`] = sub.labelStyle.color;
        colors[`${sb}|label.halo`] = sub.labelStyle.haloColor;
      }
    }
  }
  return { id, name, colors };
}

/** Applies a saved colour scheme to matching layers of a project, ported from `AppState.applyColorScheme`. */
export function applyColorScheme(
  project: ProjectSnapshot,
  scheme: MapColorScheme,
): ProjectSnapshot {
  const pick = (key: string): CodableColor | undefined => scheme.colors[key];
  const bg = pick('frame|background');
  const layers: LayerSnapshot[] = project.layers.map((layer) => {
    const base = `${layer.kind}|${layer.name}`;
    const roadColor = pick(`${base}|road.color`);
    const roadCasing = pick(`${base}|road.casing`);
    const areaFill = pick(`${base}|area.fill`);
    const areaStroke = pick(`${base}|area.stroke`);
    const poiFill = pick(`${base}|poi.fill`);
    const poiStroke = pick(`${base}|poi.stroke`);
    const labelColor = pick(`${base}|label.color`);
    const labelHalo = pick(`${base}|label.halo`);

    return {
      ...layer,
      roadStyle: {
        ...layer.roadStyle,
        ...(roadColor ? { color: roadColor } : {}),
        ...(roadCasing ? { casingColor: roadCasing } : {}),
      },
      areaStyle: {
        ...layer.areaStyle,
        ...(areaFill ? { fillColor: areaFill } : {}),
        ...(areaStroke ? { strokeColor: areaStroke } : {}),
      },
      poiStyle: {
        ...layer.poiStyle,
        ...(poiFill ? { fillColor: poiFill } : {}),
        ...(poiStroke ? { strokeColor: poiStroke } : {}),
      },
      labelStyle: {
        ...layer.labelStyle,
        ...(labelColor ? { color: labelColor } : {}),
        ...(labelHalo ? { haloColor: labelHalo } : {}),
      },
      roadSubLayers: layer.roadSubLayers.map((sub) => {
        const sb = `${base}|sub:${sub.name}`;
        const subRoadColor = pick(`${sb}|road.color`);
        const subRoadCasing = pick(`${sb}|road.casing`);
        const subLabelColor = pick(`${sb}|label.color`);
        const subLabelHalo = pick(`${sb}|label.halo`);
        return {
          ...sub,
          customStyle: {
            ...sub.customStyle,
            ...(subRoadColor ? { color: subRoadColor } : {}),
            ...(subRoadCasing ? { casingColor: subRoadCasing } : {}),
          },
          labelStyle: sub.labelStyle
            ? {
                ...sub.labelStyle,
                ...(subLabelColor ? { color: subLabelColor } : {}),
                ...(subLabelHalo ? { haloColor: subLabelHalo } : {}),
              }
            : undefined,
        };
      }),
    };
  });

  return {
    ...project,
    ...(bg ? { artboardBackground: bg } : {}),
    layers,
  };
}

/** Up to `limit` distinct colours from a scheme, sorted by slot key as in `SchemesPanel`. */
export function paletteSample(scheme: MapColorScheme, limit = 6): CodableColor[] {
  const seen = new Set<string>();
  const sample: CodableColor[] = [];
  for (const key of Object.keys(scheme.colors).sort()) {
    const color = scheme.colors[key];
    if (!color) continue;
    const hex = colorToHex(color);
    if (seen.has(hex)) continue;
    seen.add(hex);
    sample.push(color);
    if (sample.length >= limit) break;
  }
  return sample;
}
