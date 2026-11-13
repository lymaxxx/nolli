import { LoadedFont } from '@nolli/core';
import notoSansArabicBoldUrl from '@expo-google-fonts/noto-sans-arabic/700Bold/NotoSansArabic_700Bold.ttf?url';
import notoSansArabicUrl from '@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf?url';
import notoSansBoldUrl from '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf?url';
import notoSansUrl from '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url';

async function fetchFont(url: string): Promise<LoadedFont> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load font (${response.status}): ${url}`);
  return new LoadedFont(await response.arrayBuffer());
}

/**
 * The built-in fallback fonts: Noto Sans, with Noto Sans Arabic behind it, in
 * regular and bold. A project font the app has no file for is drawn with these,
 * and they follow every matched font so scripts it lacks are still drawn.
 */
export async function loadFallbackFonts(): Promise<{ regular: LoadedFont[]; bold: LoadedFont[] }> {
  const [regular, bold, arabicRegular, arabicBold] = await Promise.all([
    fetchFont(notoSansUrl),
    fetchFont(notoSansBoldUrl),
    fetchFont(notoSansArabicUrl),
    fetchFont(notoSansArabicBoldUrl),
  ]);
  return { regular: [regular, arabicRegular], bold: [bold, arabicBold] };
}
