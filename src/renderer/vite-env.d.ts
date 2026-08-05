/// <reference types="vite/client" />

import type { Theme } from './theme';

declare global {
  interface Window {
    desktop?: {
      notify: (payload: { title: string; body: string }) => Promise<void>;
      toggleFullscreen: () => Promise<boolean>;
      setMinimal: (on: boolean) => Promise<boolean>;
      exportTheme: (theme: Theme) => Promise<{ canceled: boolean; filePath?: string }>;
      importTheme: () => Promise<{ canceled: boolean; theme?: unknown }>;
    };
  }
}
