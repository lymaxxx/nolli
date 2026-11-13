import type { MapLabelLayout } from './labels';

/*
 * Compares the web app's label layout with a dump written by the macOS app
 * (docs/parity/LayoutDump.swift). Layout is in artwork space, so no view,
 * zoom or rotation enters into it.
 */

interface DumpPoint extends Array<number> {
  0: number;
  1: number;
}

export interface LayoutDump {
  version: 1;
  baseZoom: number;
  labelScale: number;
  lineLabels: {
    layerId: string;
    subId?: string;
    featureId: number;
    text: string;
    centerDist: number;
    width: number;
    pinned: boolean;
    fontSize: number;
    line: DumpPoint[];
  }[];
  pointLabels: {
    layerId: string;
    featureId: number;
    text: string;
    anchor: DumpPoint;
    featurePoint: DumpPoint;
  }[];
  icons: { layerId: string; featureId: number; point: DumpPoint }[];
}

export interface Difference {
  kind: 'line-label' | 'point-label' | 'icon';
  key: string;
  /** What differs, in words. */
  detail: string;
}

export interface LayoutComparison {
  /** Items found on both sides and within tolerance. */
  matched: number;
  /** In the macOS dump but not placed by the web app. */
  missing: Difference[];
  /** Placed by the web app but not in the macOS dump. */
  extra: Difference[];
  /** On both sides, but further apart than the tolerance. */
  moved: Difference[];
  /** True when nothing is missing, extra or moved. */
  identical: boolean;
}

/**
 * Compares two layouts. Items are matched by layer, feature and text, in order,
 * so a street labelled three times is matched label by label.
 *
 * `tolerance` is in artwork pixels (the plan suggests 1 to 2). Text widths
 * depend on the font, so with a different font the *set* of labels can match
 * while positions drift; compare positions only once both sides use the same
 * font.
 */
export function compareLayouts(
  dump: LayoutDump,
  layout: MapLabelLayout,
  tolerance = 2,
): LayoutComparison {
  const missing: Difference[] = [];
  const extra: Difference[] = [];
  const moved: Difference[] = [];
  let matched = 0;

  const norm = (id: string) => id.toLowerCase();
  const distance = (a: readonly number[], b: { x: number; y: number }) => Math.hypot(a[0]! - b.x, a[1]! - b.y);

  const group = <T>(items: T[], key: (item: T) => string): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const k = key(item);
      const list = map.get(k);
      if (list) list.push(item);
      else map.set(k, [item]);
    }
    return map;
  };

  // Road names: also compare where along the street, and how wide.
  const webLines = group(layout.lineLabels, (l) => `${norm(l.layerId)}|${l.featureId}|${l.text}`);
  const dumpLines = group(dump.lineLabels, (l) => `${norm(l.layerId)}|${l.featureId}|${l.text}`);
  for (const key of new Set([...dumpLines.keys(), ...webLines.keys()])) {
    const expected = [...(dumpLines.get(key) ?? [])].sort((a, b) => a.centerDist - b.centerDist);
    const actual = [...(webLines.get(key) ?? [])].sort((a, b) => a.centerDist - b.centerDist);
    const common = Math.min(expected.length, actual.length);
    for (let i = 0; i < common; i++) {
      const off = Math.abs(expected[i]!.centerDist - actual[i]!.centerDist);
      if (off > tolerance) {
        moved.push({
          kind: 'line-label',
          key,
          detail: `centre differs by ${off.toFixed(1)} px (macOS ${expected[i]!.centerDist.toFixed(1)}, web ${actual[i]!.centerDist.toFixed(1)})`,
        });
      } else matched++;
    }
    for (const e of expected.slice(common)) {
      missing.push({ kind: 'line-label', key, detail: `at ${e.centerDist.toFixed(1)} px` });
    }
    for (const a of actual.slice(common)) {
      extra.push({ kind: 'line-label', key, detail: `at ${a.centerDist.toFixed(1)} px` });
    }
  }

  const compareAnchors = <A extends { layerId: string; featureId: number }, B extends { layerId: string; featureId: number }>(
    kind: Difference['kind'],
    expected: A[],
    actual: B[],
    keyOf: (item: { layerId: string; featureId: number; text?: string }) => string,
    positions: (a: A, b: B) => number,
  ) => {
    const webMap = group(actual, keyOf);
    const dumpMap = group(expected, keyOf);
    for (const key of new Set([...dumpMap.keys(), ...webMap.keys()])) {
      const e = dumpMap.get(key) ?? [];
      const a = webMap.get(key) ?? [];
      const common = Math.min(e.length, a.length);
      for (let i = 0; i < common; i++) {
        const off = positions(e[i]!, a[i]!);
        if (off > tolerance) moved.push({ kind, key, detail: `position differs by ${off.toFixed(1)} px` });
        else matched++;
      }
      for (let i = common; i < e.length; i++) missing.push({ kind, key, detail: 'not placed by the web app' });
      for (let i = common; i < a.length; i++) extra.push({ kind, key, detail: 'not in the macOS layout' });
    }
  };

  compareAnchors(
    'point-label',
    dump.pointLabels,
    layout.pointLabels,
    (item) => `${norm(item.layerId)}|${item.featureId}|${item.text ?? ''}`,
    (e, a) => distance(e.anchor, a.anchor),
  );
  compareAnchors(
    'icon',
    dump.icons,
    layout.icons,
    (item) => `${norm(item.layerId)}|${item.featureId}`,
    (e, a) => distance(e.point, a.point),
  );

  return {
    matched,
    missing,
    extra,
    moved,
    identical: missing.length === 0 && extra.length === 0 && moved.length === 0,
  };
}
