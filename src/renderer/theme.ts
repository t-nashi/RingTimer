export type Theme = {
  version: 1;
  id: string;
  name: string;
  backgroundColor: string;
  backgroundImage: string;
  backgroundImageEnabled?: boolean;
  textColor: string;
  accentColor: string;
  alarmSound: 'pulse' | 'beacon' | 'chime' | 'beep';
  builtIn?: boolean;
};

export const DEFAULT_BACKGROUND_IMAGE_URL = 'https://picsum.photos/1600/900';

export const builtInThemes: Theme[] = [
  {
    version: 1,
    id: 'midnight',
    name: 'Midnight',
    backgroundColor: '#101522',
    backgroundImage: DEFAULT_BACKGROUND_IMAGE_URL,
    backgroundImageEnabled: false,
    textColor: '#f7fbff',
    accentColor: '#58d5ff',
    alarmSound: 'pulse',
    builtIn: true
  },
  {
    version: 1,
    id: 'studio',
    name: 'Studio',
    backgroundColor: '#24201d',
    backgroundImage: DEFAULT_BACKGROUND_IMAGE_URL,
    backgroundImageEnabled: false,
    textColor: '#fff7ed',
    accentColor: '#ffb86b',
    alarmSound: 'beep',
    builtIn: true
  },
  {
    version: 1,
    id: 'forest',
    name: 'Forest',
    backgroundColor: '#102019',
    backgroundImage: DEFAULT_BACKGROUND_IMAGE_URL,
    backgroundImageEnabled: false,
    textColor: '#eefbf3',
    accentColor: '#7ee2a8',
    alarmSound: 'beacon',
    builtIn: true
  }
];

export function isTheme(value: unknown): value is Theme {
  const theme = value as Partial<Theme>;
  return Boolean(
    theme &&
      theme.version === 1 &&
      typeof theme.id === 'string' &&
      typeof theme.name === 'string' &&
      typeof theme.backgroundColor === 'string' &&
      typeof theme.backgroundImage === 'string' &&
      (theme.backgroundImageEnabled === undefined || typeof theme.backgroundImageEnabled === 'boolean') &&
      typeof theme.textColor === 'string' &&
      typeof theme.accentColor === 'string' &&
      ['pulse', 'beacon', 'chime', 'beep'].includes(String(theme.alarmSound))
  );
}

export function makeUserTheme(theme: Theme): Theme {
  return {
    ...theme,
    id: `user-${Date.now()}`,
    name: theme.name.trim() || 'Saved Theme',
    builtIn: false
  };
}
