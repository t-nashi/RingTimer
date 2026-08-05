import { createInitialSession, type Session } from './session';
import { builtInThemes, isTheme, type Theme } from './theme';

const STORAGE_KEY = 'ringtimer-desktop-state-v1';
const LEGACY_STORAGE_KEY = 'timer-tab-desktop-state-v1';

export type PersistedState = {
  session: Session;
  activeThemeId: string;
  userThemes: Theme[];
  zoom: number;
  alarmVolume: number;
  alarmMuted: boolean;
  minimal: boolean;
};

export function loadState(): PersistedState {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        raw = legacy;
      }
    }
    if (!raw) throw new Error('No state');
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      session: parsed.session ?? createInitialSession(),
      activeThemeId: parsed.activeThemeId ?? builtInThemes[0].id,
      userThemes: Array.isArray(parsed.userThemes) ? parsed.userThemes.filter(isTheme) : [],
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 1,
      alarmVolume: typeof parsed.alarmVolume === 'number' ? Math.min(1, Math.max(0, parsed.alarmVolume)) : 0.7,
      alarmMuted: typeof parsed.alarmMuted === 'boolean' ? parsed.alarmMuted : false,
      minimal: typeof parsed.minimal === 'boolean' ? parsed.minimal : false
    };
  } catch {
    return {
      session: createInitialSession(),
      activeThemeId: builtInThemes[0].id,
      userThemes: [],
      zoom: 1,
      alarmVolume: 0.7,
      alarmMuted: false,
      minimal: false
    };
  }
}

export function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
