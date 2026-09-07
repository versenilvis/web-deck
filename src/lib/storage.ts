import { browser } from 'wxt/browser';

export interface SiteConfig {
  enabled: boolean;
  customCss: string;
  customJs: string;
  modules?: Record<string, boolean>;
}

export interface GitHubConfig {
  repo: string;
  branch: string;
  autoUpdate?: boolean;
  updateIntervalMinutes?: number;
  lastSyncedCommit?: string;
  lastSyncedAt?: number;
  lastSyncMessage?: string;
}

export interface Settings {
  globalEnabled: boolean;
  sites: Record<string, SiteConfig>;
  ytChat: {
    enabled: boolean;
    width: number;
    height: number | string;
    top?: number | null;
    left?: number | null;
    scale?: number;
    hideHeader?: boolean;
    hideInput?: boolean;
  };
  github: GitHubConfig;
  syncedModules?: Record<string, Record<string, string>>;
}

export const defaultSettings: Settings = {
  globalEnabled: true,
  sites: {
    'youtube.com': { enabled: true, customCss: '', customJs: '' },
    'x.com': { enabled: true, customCss: '', customJs: '' },
    'github.com': { enabled: true, customCss: '', customJs: '' },
    'facebook.com': { enabled: true, customCss: '', customJs: '' },
    'messenger.com': { enabled: true, customCss: '', customJs: '' },
    'threads.net': { enabled: true, customCss: '', customJs: '' },
    'threads.com': { enabled: true, customCss: '', customJs: '' },
  },
  ytChat: {
    enabled: true,
    width: 400,
    height: '68vh',
    top: null,
    left: null,
    scale: 1,
    hideHeader: false,
    hideInput: false,
  },
  github: {
    repo: 'versenilvis/web-deck',
    branch: 'main',
    autoUpdate: true,
    updateIntervalMinutes: 15,
    lastSyncedCommit: '',
    lastSyncedAt: 0,
    lastSyncMessage: '',
  },
  syncedModules: {},
};

export const STORAGE_KEY = 'wd_settings';
export const LEGACY_STORAGE_KEY = 'cb_settings';

// fetch stored settings with default fallback
export async function getSettings(): Promise<Settings> {
  try {
    const data = await browser.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    const raw = data?.[STORAGE_KEY] || data?.[LEGACY_STORAGE_KEY];
    if (!raw) {
      return defaultSettings;
    }
    const current = raw as Settings;
    const currentChat = current.ytChat || defaultSettings.ytChat;
    if (currentChat.height === '86vh') {
      currentChat.height = '68vh';
    }
    if (current.github?.repo === 'versenilvis/chrome-beauty' || !current.github?.repo) {
      if (current.github) {
        current.github.repo = 'versenilvis/web-deck';
      }
    }
    if (current.syncedModules) {
      current.syncedModules = {};
    }
    if (current.sites?.['youtube.com']?.customCss) {
      current.sites['youtube.com'].customCss = '';
    }
    return {
      ...defaultSettings,
      ...current,
      sites: {
        ...defaultSettings.sites,
        ...(current.sites || {}),
      },
      ytChat: {
        ...defaultSettings.ytChat,
        ...currentChat,
      },
      github: {
        ...defaultSettings.github,
        ...(current.github || {}),
      },
      syncedModules: {
        ...(defaultSettings.syncedModules || {}),
        ...(current.syncedModules || {}),
      },
    };
  } catch {
    return defaultSettings;
  }
}

// persist entire settings object
export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}

// helper to get site config with fallback
export function getDomainConfig(settings: Settings, domain: string): SiteConfig {
  return settings.sites[domain] || { enabled: true, customCss: '', customJs: '' };
}
