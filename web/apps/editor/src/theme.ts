import { useCallback, useEffect, useState } from 'react';

/** What the user chose: follow the system, or force one. */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'nolli-theme';
const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/** The next choice in the cycle system → light → dark → system. */
export function nextPreference(current: ThemePreference): ThemePreference {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function apply(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference, darkQuery().matches);
}

/**
 * The theme choice, kept in this browser's storage. While the choice is
 * "system" the page follows the operating system as it changes.
 */
export function useTheme(): { preference: ThemePreference; cycle: () => void } {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    apply(preference);
    if (preference !== 'system') return;
    const query = darkQuery();
    const onChange = () => apply('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((current) => {
      const next = nextPreference(current);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not being able to remember the choice is not worth failing for.
      }
      return next;
    });
  }, []);

  return { preference, cycle };
}
