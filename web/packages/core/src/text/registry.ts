import type { LayerSnapshot } from '../model/layers';
import type { LoadedFont } from './font';
import type { FontProvider } from './metrics';

/** How well a project font was matched. */
export type FontMatch =
  /** The family and face the project names. */
  | { kind: 'exact' }
  /** The family, but a different face (the nearest weight). */
  | { kind: 'family'; style: string }
  /** Nothing of that family: the built-in fallback is used. */
  | { kind: 'fallback' };

/** Weight numbers for the face names the macOS weight picker offers. */
const WEIGHTS: Record<string, number> = {
  thin: 100,
  ultralight: 100,
  'ultra light': 100,
  extralight: 200,
  'extra light': 200,
  light: 300,
  book: 400,
  regular: 400,
  normal: 400,
  roman: 400,
  medium: 500,
  semibold: 600,
  'semi bold': 600,
  demibold: 600,
  demi: 600,
  bold: 700,
  extrabold: 800,
  'extra bold': 800,
  heavy: 800,
  black: 900,
};

/** True for faces that are slanted ("Italic", "Bold Oblique"). */
export function isItalicStyle(style: string): boolean {
  return /italic|oblique/i.test(style);
}

/** The weight number of a face name such as "Medium" or "Bold Italic"; 400 when it names none. */
export function weightValue(style: string): number {
  const name = style
    .toLowerCase()
    .replace(/italic|oblique/g, '')
    .trim();
  return WEIGHTS[name] ?? 400;
}

/** Chooses among a family's faces: the exact name, else the nearest weight with the requested slant. */
function chooseFace<F extends { style: string }>(faces: readonly F[], style: string): { face: F; exact: boolean } | undefined {
  const exact = faces.find((face) => face.style.toLowerCase() === style.toLowerCase());
  if (exact) return { face: exact, exact: true };
  const wantWeight = weightValue(style);
  const wantItalic = isItalicStyle(style);
  let best: F | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const face of faces) {
    const score =
      Math.abs(weightValue(face.style) - wantWeight) + (isItalicStyle(face.style) === wantItalic ? 0 : 1000);
    if (score < bestScore) {
      bestScore = score;
      best = face;
    }
  }
  return best ? { face: best, exact: false } : undefined;
}

/**
 * How a requested font would be matched by a set of available faces, without
 * needing the fonts themselves. The interface uses it to say which fonts a
 * project has and which it is missing.
 */
export function matchFont(
  available: readonly { family: string; style: string }[],
  request: { family: string; style: string },
): FontMatch {
  const faces = available.filter((face) => face.family.toLowerCase() === request.family.toLowerCase());
  const chosen = chooseFace(faces, request.style);
  if (!chosen) return { kind: 'fallback' };
  return chosen.exact ? { kind: 'exact' } : { kind: 'family', style: chosen.face.style };
}

interface Face {
  style: string;
  font: LoadedFont;
}

/**
 * The fonts the app has for the names projects use. A project names a family
 * and a face ("Onsite Standard TRIAL", "Bold"); this finds the font for it, or
 * says it has none and falls back.
 *
 * The built-in fallback fonts always follow the matched font in the chain, so a
 * script the project's font lacks (Arabic, say) is still drawn.
 */
export class FontRegistry implements FontProvider {
  private readonly families = new Map<string, Face[]>();

  constructor(
    private readonly fallback: { regular: readonly LoadedFont[]; bold: readonly LoadedFont[] },
  ) {
    if (fallback.regular.length === 0 || fallback.bold.length === 0) {
      throw new Error('FontRegistry needs fallback fonts');
    }
  }

  /** Registers a font for a family and face. A second font for the same pair replaces the first. */
  add(family: string, style: string, font: LoadedFont): void {
    const key = family.toLowerCase();
    const faces = this.families.get(key) ?? [];
    const existing = faces.findIndex((face) => face.style.toLowerCase() === style.toLowerCase());
    if (existing >= 0) faces[existing] = { style, font };
    else faces.push({ style, font });
    this.families.set(key, faces);
  }

  remove(family: string, style: string): void {
    const key = family.toLowerCase();
    const faces = (this.families.get(key) ?? []).filter(
      (face) => face.style.toLowerCase() !== style.toLowerCase(),
    );
    if (faces.length > 0) this.families.set(key, faces);
    else this.families.delete(key);
  }

  /** How `family` / `style` resolves, and the font it resolves to if it has one of its own. */
  resolve(family: string, style: string): { match: FontMatch; font?: LoadedFont } {
    const faces = this.families.get(family.toLowerCase());
    if (!faces || faces.length === 0) return { match: { kind: 'fallback' } };

    const chosen = chooseFace(faces, style);
    if (!chosen) return { match: { kind: 'fallback' } };
    return {
      match: chosen.exact ? { kind: 'exact' } : { kind: 'family', style: chosen.face.style },
      font: chosen.face.font,
    };
  }

  fontsFor(fontName: string, fontWeight: string): readonly LoadedFont[] {
    const { font } = this.resolve(fontName, fontWeight);
    const fallback = weightValue(fontWeight) >= 600 ? this.fallback.bold : this.fallback.regular;
    return font ? [font, ...fallback] : fallback;
  }
}

/** A font a project asks for. */
export interface FontRequest {
  family: string;
  style: string;
}

/**
 * The fonts a project's labels use, so the app can tell the user which ones it
 * has and which it is replacing. Only label styles that are switched on count.
 */
export function fontsUsed(layers: readonly LayerSnapshot[]): FontRequest[] {
  const seen = new Map<string, FontRequest>();
  const note = (style: { enabled: boolean; fontName: string; fontWeight: string }) => {
    if (!style.enabled || style.fontName === '') return;
    const key = `${style.fontName.toLowerCase()}|${style.fontWeight.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, { family: style.fontName, style: style.fontWeight });
  };
  for (const layer of layers) {
    note(layer.labelStyle);
    for (const sub of layer.roadSubLayers) if (sub.labelStyle) note(sub.labelStyle);
  }
  return [...seen.values()];
}
