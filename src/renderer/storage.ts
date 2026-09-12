import { createInitialSession, type Session } from './session';
import { builtInThemes, isTheme, type Theme } from './theme';

const STORAGE_KEY = 'ringtimer-desktop-state-v1';
const LEGACY_STORAGE_KEY = 'timer-tab-desktop-state-v1';

/** 鳴動の自動停止までの秒数。0 は自動停止しない(鳴り続ける)ことを表す */
export const AUTO_STOP_OPTIONS = [0, 30, 60, 180, 300, 600] as const;
export const DEFAULT_AUTO_STOP_SEC = 300;

export type PersistedState = {
  session: Session;
  activeThemeId: string;
  userThemes: Theme[];
  zoom: number;
  alarmVolume: number;
  alarmMuted: boolean;
  minimal: boolean;
  autoStopSec: number;
};

function normalizeAutoStopSec(value: unknown): number {
  return AUTO_STOP_OPTIONS.includes(value as (typeof AUTO_STOP_OPTIONS)[number])
    ? (value as number)
    : DEFAULT_AUTO_STOP_SEC;
}

/**
 * 保存済みセッションを現行の型に合わせる。
 * ringingSince は後から追加した項目なので、旧データで鳴動中のまま保存されていた
 * 場合は復元時点を鳴動開始とみなす(直後に自動停止扱いにならないようにするため)。
 */
function normalizeSession(session: Session | undefined, now: number): Session {
  if (!session) return createInitialSession();
  if (typeof session.ringingSince === 'number' || session.ringingSince === null) return session;
  return { ...session, ringingSince: session.state === 'ringing' ? now : null };
}

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
      session: normalizeSession(parsed.session, Date.now()),
      activeThemeId: parsed.activeThemeId ?? builtInThemes[0].id,
      userThemes: Array.isArray(parsed.userThemes) ? parsed.userThemes.filter(isTheme) : [],
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 1,
      alarmVolume: typeof parsed.alarmVolume === 'number' ? Math.min(1, Math.max(0, parsed.alarmVolume)) : 0.7,
      alarmMuted: typeof parsed.alarmMuted === 'boolean' ? parsed.alarmMuted : false,
      minimal: typeof parsed.minimal === 'boolean' ? parsed.minimal : false,
      autoStopSec: normalizeAutoStopSec(parsed.autoStopSec)
    };
  } catch {
    return {
      session: createInitialSession(),
      activeThemeId: builtInThemes[0].id,
      userThemes: [],
      zoom: 1,
      alarmVolume: 0.7,
      alarmMuted: false,
      minimal: false,
      autoStopSec: DEFAULT_AUTO_STOP_SEC
    };
  }
}

export function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
