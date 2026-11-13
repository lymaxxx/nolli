import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LoadedFont } from '../text/font';

const require = createRequire(import.meta.url);

function load(specifier: string): LoadedFont {
  return new LoadedFont(readFileSync(require.resolve(specifier)));
}

/** Open fonts (SIL Open Font License) installed as dev dependencies, for tests only. */
export const notoSans = (): LoadedFont =>
  load('@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf');
export const notoSansArabic = (): LoadedFont =>
  load('@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf');
