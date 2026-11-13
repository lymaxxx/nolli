import { LoadedFont } from '@nolli/core';
import notoSansArabicUrl from '@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf?url';
import notoSansUrl from '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url';

async function fetchFont(url: string): Promise<LoadedFont> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load font (${response.status}): ${url}`);
  return new LoadedFont(await response.arrayBuffer());
}

/**
 * The spike's font chain: Noto Sans, with Noto Sans Arabic as the fallback.
 * Both are open fonts bundled for development; real projects will bring their own.
 */
export function loadSpikeFonts(): Promise<LoadedFont[]> {
  return Promise.all([fetchFont(notoSansUrl), fetchFont(notoSansArabicUrl)]);
}
