import { LoadedFont, type FontProvider } from '@nolli/core';
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
 * Placeholder font handling until the font-mapping dialog exists.
 *
 * Projects name fonts such as "Helvetica Neue" or "Onsite Standard TRIAL" that
 * a browser cannot supply, so every project font resolves to Noto Sans with
 * Noto Sans Arabic behind it, in regular or bold. Labels therefore will not
 * match the macOS app's letterforms or widths yet; only the placement rules are
 * the same.
 */
export async function loadFontProvider(): Promise<FontProvider> {
  const [regular, bold, arabicRegular, arabicBold] = await Promise.all([
    fetchFont(notoSansUrl),
    fetchFont(notoSansBoldUrl),
    fetchFont(notoSansArabicUrl),
    fetchFont(notoSansArabicBoldUrl),
  ]);
  const regularChain = [regular, arabicRegular];
  const boldChain = [bold, arabicBold];
  return {
    fontsFor(_fontName, fontWeight) {
      return /bold|black|heavy|demi/i.test(fontWeight) ? boldChain : regularChain;
    },
  };
}
