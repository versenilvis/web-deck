import { defineConfig } from 'wxt';
import path from 'path';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'Web Deck',
    description: 'All-in-one web customizer, media deck, and player optimizer',
    permissions: ['storage', 'activeTab', 'alarms'],
    host_permissions: ['https://api.github.com/*', 'https://raw.githubusercontent.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'web-deck@local',
        strict_min_version: '109.0',
      },
    },
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
    action: {
      default_title: 'Web Deck',
      default_icon: {
        '16': 'icons/icon-16.png',
        '32': 'icons/icon-32.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png',
      },
    },
    // suppress firefox data collection notification
    data_collection_permissions: {
      user_data: false,
    },
  },
  suppressWarnings: {
    firefoxDataCollection: true,
  },
  vite: () => ({
    resolve: {
      alias: {
        '@sites': path.resolve(__dirname, 'sites'),
      },
    },
  }),
});
