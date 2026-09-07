<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { getSettings, saveSettings, type Settings } from '../../lib/storage';
  import { resolveDomain, siteStyles, getBuiltinCss, siteModulesMeta } from '../../lib/sites';
  import { syncWithGitHub } from '../../lib/github-sync';

  const extensionVersion = browser.runtime.getManifest()?.version || '0.1.0';

  let currentTab = $state<'general' | 'modules' | 'css' | 'js' | 'github'>('general');
  let currentDomain = $state<string>('');
  let selectedDomain = $state<string>('');
  let globalEnabled = $state(true);
  let siteEnabled = $state(true);
  let customCss = $state('');
  let customJs = $state('');
  let ytChatEnabled = $state(true);
  let ytChatWidth = $state(400);
  let ytChatHeight = $state<number | string>('68vh');
  let ytChatScale = $state(1);
  let ytChatHideHeader = $state(false);
  let ytChatHideInput = $state(false);
  let statusMessage = $state('');
  let isSyncing = $state(false);
  let isLiveSaved = $state(true);

  let githubAutoUpdate = $state(true);
  let githubInterval = $state(15);
  let isPollDropdownOpen = $state(false);
  let lastSyncedCommit = $state('');
  let lastSyncedAt = $state(0);
  let lastSyncMessage = $state('');

  const pollIntervalOptions = [
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hr' },
    { value: 360, label: '6 hr' },
    { value: 1440, label: '24 hr' },
  ];

  function selectPollInterval(val: number) {
    githubInterval = val;
    isPollDropdownOpen = false;
    persist();
  }

  let settingsState = $state<Settings | null>(null);
  let autoApplyTimer: ReturnType<typeof setTimeout> | null = null;
  let faviconCache = $state<Record<string, string>>({});

  const cssPlaceholder = '/* full css for current site */';
  const jsPlaceholder = '// custom js for current site\nconsole.log("web-deck loaded");';

  const supportedSites = Object.keys(siteStyles);

  onMount(async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:')) {
        const url = new URL(tab.url);
        currentDomain = resolveDomain(url.hostname);
      } else {
        currentDomain = 'youtube.com';
      }
    } catch {
      currentDomain = 'youtube.com';
    }

    selectedDomain = currentDomain || 'youtube.com';

    // load persistent favicon cache to avoid network requests
    try {
      const stored = await browser.storage.local.get('wd_favicons');
      if (stored?.wd_favicons && typeof stored.wd_favicons === 'object') {
        faviconCache = stored.wd_favicons as Record<string, string>;
      }
    } catch {}

    settingsState = await getSettings();
    globalEnabled = settingsState.globalEnabled;
    ytChatEnabled = settingsState.ytChat.enabled;
    ytChatWidth = settingsState.ytChat.width;
    ytChatHeight = settingsState.ytChat.height;
    ytChatScale = settingsState.ytChat.scale || 1;
    ytChatHideHeader = Boolean(settingsState.ytChat.hideHeader);
    ytChatHideInput = Boolean(settingsState.ytChat.hideInput);

    githubAutoUpdate = settingsState.github?.autoUpdate !== false;
    const storedInterval = Number(settingsState.github?.updateIntervalMinutes);
    githubInterval = pollIntervalOptions.some((opt) => opt.value === storedInterval) ? storedInterval : 15;
    lastSyncedCommit = settingsState.github?.lastSyncedCommit || '';
    lastSyncedAt = settingsState.github?.lastSyncedAt || 0;
    lastSyncMessage = settingsState.github?.lastSyncMessage || '';

    loadDomainState(selectedDomain);
  });

  // load active state for specific site into editor
  function loadDomainState(domain: string) {
    if (!settingsState) return;
    const siteConfig = settingsState.sites[domain] || {
      enabled: true,
      customCss: '',
      customJs: '',
    };
    siteEnabled = siteConfig.enabled !== false;
    const builtin = getBuiltinCss(domain, siteConfig.modules, settingsState.syncedModules) || '';
    customCss = siteConfig.customCss || builtin;
    customJs = siteConfig.customJs || '';
  }

  // check if a specific module of a site is enabled
  function isModuleActive(domain: string, moduleId: string): boolean {
    if (!settingsState) return true;
    const siteConfig = settingsState.sites[domain];
    if (!siteConfig || !siteConfig.modules) return true;
    return siteConfig.modules[moduleId] !== false;
  }

  // toggle a specific module on or off
  async function toggleModule(domain: string, moduleId: string, enabled: boolean) {
    if (!settingsState) return;
    if (!settingsState.sites[domain]) {
      settingsState.sites[domain] = { enabled: true, customCss: '', customJs: '', modules: {} };
    }
    const site = settingsState.sites[domain];
    if (!site) return;
    if (!site.modules) {
      site.modules = {};
    }
    site.modules[moduleId] = enabled;

    const builtin = getBuiltinCss(domain, site.modules, settingsState.syncedModules) || '';
    if (!site.customCss || site.customCss === getBuiltinCss(domain, undefined, settingsState.syncedModules)) {
      site.customCss = '';
      if (domain === (selectedDomain || currentDomain)) {
        customCss = builtin;
      }
    }

    await saveSettings(settingsState);
    await notifyActiveTab();
    flashStatus(`${moduleId} ${enabled ? 'enabled' : 'disabled'}`);
  }

  // enable or disable all modules for a domain
  async function setAllModules(domain: string, enabled: boolean) {
    if (!settingsState) return;
    const modules = siteModulesMeta[domain] || [];
    if (!settingsState.sites[domain]) {
      settingsState.sites[domain] = { enabled: true, customCss: '', customJs: '', modules: {} };
    }
    const site = settingsState.sites[domain];
    if (!site) return;
    if (!site.modules) {
      site.modules = {};
    }
    for (const mod of modules) {
      site.modules[mod.id] = enabled;
    }

    const builtin = getBuiltinCss(domain, site.modules, settingsState.syncedModules) || '';
    if (!site.customCss || site.customCss === getBuiltinCss(domain, undefined, settingsState.syncedModules)) {
      site.customCss = '';
      if (domain === (selectedDomain || currentDomain)) {
        customCss = builtin;
      }
    }

    await saveSettings(settingsState);
    await notifyActiveTab();
    flashStatus(`All ${domain} modules ${enabled ? 'enabled' : 'disabled'}`);
  }

  function getActiveModulesCount(domain: string): { active: number; total: number } {
    const list = siteModulesMeta[domain] || [];
    const active = list.filter((m) => isModuleActive(domain, m.id)).length;
    return { active, total: list.length };
  }

  // switch active editing site
  function selectSiteForEdit(site: string) {
    selectedDomain = site;
    loadDomainState(site);
    currentTab = 'css';
  }

  // check if site is enabled in settings
  function isSiteActive(site: string): boolean {
    if (!settingsState) return true;
    return settingsState.sites[site]?.enabled !== false;
  }

  // toggle enabled switch for specific site
  async function toggleSite(site: string, enabled: boolean) {
    if (!settingsState) return;
    if (!settingsState.sites[site]) {
      settingsState.sites[site] = { enabled: true, customCss: '', customJs: '' };
    }
    const targetSite = settingsState.sites[site];
    if (targetSite) {
      targetSite.enabled = enabled;
    }
    if (site === selectedDomain || site === currentDomain) {
      siteEnabled = enabled;
    }
    await saveSettings(settingsState);
    await notifyActiveTab();
    flashStatus(`${site} ${enabled ? 'enabled' : 'disabled'}`);
  }

  // debounced live auto apply for css
  function onCssInput() {
    isLiveSaved = false;
    if (autoApplyTimer) clearTimeout(autoApplyTimer);
    autoApplyTimer = setTimeout(async () => {
      await persistSilent();
      isLiveSaved = true;
    }, 180);
  }

  // debounced live auto apply for js
  function onJsInput() {
    if (autoApplyTimer) clearTimeout(autoApplyTimer);
    autoApplyTimer = setTimeout(async () => {
      await persistSilent();
    }, 300);
  }

  // notify active tabs to reload styles immediately
  async function notifyActiveTab() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      for (const tab of tabs) {
        if (tab.id) {
          browser.tabs.sendMessage(tab.id, { type: 'cb_reload_assets' }).catch(() => {});
        }
      }
    } catch {}
  }

  // persist silently without toast for instant updates
  async function persistSilent() {
    if (!settingsState) return;
    const target = selectedDomain || currentDomain;
    if (!target) return;

    const siteConfig = settingsState.sites[target] || {
      enabled: true,
      customCss: '',
      customJs: '',
    };
    siteConfig.enabled = siteEnabled;
    const builtin = getBuiltinCss(target) || '';
    siteConfig.customCss = customCss === builtin ? '' : customCss;
    siteConfig.customJs = customJs;
    settingsState.sites[target] = siteConfig;

    await saveSettings(settingsState);
    await notifyActiveTab();
  }

  // commit changes to extension storage with toast feedback
  async function persist() {
    if (!settingsState) return;

    settingsState.globalEnabled = globalEnabled;
    settingsState.ytChat.enabled = ytChatEnabled;
    settingsState.ytChat.width = ytChatWidth;
    settingsState.ytChat.height = ytChatHeight;
    settingsState.ytChat.scale = ytChatScale;
    settingsState.ytChat.hideHeader = ytChatHideHeader;
    settingsState.ytChat.hideInput = ytChatHideInput;

    settingsState.github = {
      repo: 'versenilvis/web-deck',
      branch: 'main',
      autoUpdate: githubAutoUpdate,
      updateIntervalMinutes: Number(githubInterval) || 15,
      lastSyncedCommit,
      lastSyncedAt,
      lastSyncMessage,
    };

    const target = selectedDomain || currentDomain;
    const siteConfig = settingsState.sites[target] || {
      enabled: true,
      customCss: '',
      customJs: '',
    };
    siteConfig.enabled = siteEnabled;
    const builtin = getBuiltinCss(target, siteConfig.modules, settingsState.syncedModules) || '';
    siteConfig.customCss = customCss === builtin ? '' : customCss;
    siteConfig.customJs = customJs;
    settingsState.sites[target] = siteConfig;

    await saveSettings(settingsState);
    await notifyActiveTab();
    isLiveSaved = true;
    flashStatus('Saved and applied instantly');
  }

  // reload original preset into editor
  async function reloadBuiltinPreset() {
    const target = selectedDomain || currentDomain;
    const builtin = getBuiltinCss(target, undefined, settingsState?.syncedModules);
    if (builtin) {
      customCss = builtin;
      if (settingsState && settingsState.sites[target]) {
        settingsState.sites[target].customCss = '';
        await saveSettings(settingsState);
        await notifyActiveTab();
      }
      flashStatus('Loaded official preset');
    }
  }

  // trigger background update with source repository
  async function handleSyncGitHub() {
    isSyncing = true;
    flashStatus('Checking for updates...');
    try {
      const res = await syncWithGitHub(true);
      settingsState = await getSettings();
      lastSyncedCommit = settingsState.github?.lastSyncedCommit || '';
      lastSyncedAt = settingsState.github?.lastSyncedAt || 0;
      lastSyncMessage = settingsState.github?.lastSyncMessage || '';
      if (res.updated) {
        loadDomainState(selectedDomain);
      }
      flashStatus(res.message);
    } catch (err: any) {
      flashStatus(err.message || 'Update failed');
    } finally {
      isSyncing = false;
    }
  }

  // reset chat widget size to default
  async function resetChatSize() {
    ytChatWidth = 400;
    ytChatHeight = '68vh';
    ytChatScale = 1;
    ytChatHideHeader = false;
    ytChatHideInput = false;
    if (settingsState) {
      settingsState.ytChat.top = null;
      settingsState.ytChat.left = null;
      settingsState.ytChat.scale = 1;
      settingsState.ytChat.hideHeader = false;
      settingsState.ytChat.hideInput = false;
    }
    await persist();
  }

  // reset all sites to builtin presets
  async function handleResetAllSites() {
    if (!settingsState?.sites) return;
    for (const site of Object.keys(settingsState.sites)) {
      const siteConfig = settingsState.sites[site];
      if (siteConfig) {
        siteConfig.customCss = '';
        siteConfig.customJs = '';
      }
    }
    settingsState.syncedModules = {};
    loadDomainState(selectedDomain);
    await saveSettings(settingsState);
    await notifyActiveTab();
    flashStatus('All site styles reset to default');
  }

  // show temporary feedback message
  function flashStatus(msg: string) {
    statusMessage = msg;
    setTimeout(() => {
      statusMessage = '';
    }, 2800);
  }

  // format timestamp to us datetime: mm/dd/yyyy, hh:mm:ss am/pm
  function formatUsDateTime(timestamp: number): string {
    if (!timestamp) return 'Never';
    const d = new Date(timestamp);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const hh = String(hours).padStart(2, '0');
    return `${mm}/${dd}/${yyyy}, ${hh}:${minutes}:${seconds} ${ampm}`;
  }

  // open external link in new browser tab
  function openExternalUrl(url: string) {
    try {
      browser.tabs.create({ url });
    } catch {
      window.open(url, '_blank');
    }
  }
</script>

{#snippet siteIcon(domain: string, size: string = '1.35rem')}
  {#if domain === 'youtube.com'}
    <!-- official vector youtube logo (0ms, offline) -->
    <svg viewBox="0 0 24 24" style="width: {size}; height: {size}; border-radius: 0.4rem; flex-shrink: 0;">
      <path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/>
      <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  {:else if domain === 'threads.net' || domain === 'threads.com'}
    <!-- official vector threads logo (0ms, offline) -->
    <svg viewBox="0 0 24 24" fill="currentColor" style="width: {size}; height: {size}; border-radius: 0.4rem; flex-shrink: 0; color: #ffffff;">
      <path d="M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z"/>
    </svg>
  {:else if domain === 'github.com'}
    <!-- official vector github octocat (0ms, offline) -->
    <svg viewBox="0 0 24 24" fill="#FFFFFF" style="width: {size}; height: {size}; border-radius: 0.4rem; flex-shrink: 0;">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  {:else if domain === 'x.com' || domain === 'twitter.com'}
    <!-- official vector x logo (0ms, offline) -->
    <svg viewBox="0 0 24 24" fill="#FFFFFF" style="width: {size}; height: {size}; border-radius: 0.4rem; flex-shrink: 0;">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  {:else if domain === 'facebook.com'}
    <!-- official vector facebook logo (0ms, offline) -->
    <svg viewBox="0 0 24 24" fill="#1877F2" style="width: {size}; height: {size}; border-radius: 0.4rem; flex-shrink: 0;">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  {:else if domain === 'messenger.com'}
    <!-- official vector messenger logo (0ms, offline) -->
    <svg viewBox="0 0 24 24" fill="#0084FF" style="width: {size}; height: {size}; border-radius: 0.4rem; flex-shrink: 0;">
      <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.43 3.16 7.15V22l3.03-1.66c1.19.33 2.47.51 3.81.51 5.64 0 10-4.13 10-9.7S17.64 2 12 2zm1.19 13.06l-2.67-2.85-5.21 2.85 5.73-6.09 2.74 2.85 5.14-2.85-5.73 6.09z"/>
    </svg>
  {:else}
    <!-- dynamic domain: cached or fetched favicon with clean svg globe fallback -->
    <img
      src={faviconCache[domain] || `https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt={domain}
      class="site-favicon"
      style="width: {size}; height: {size};"
      loading="lazy"
      onerror={(e) => {
        // fallback to globe svg if image fails
        (e.currentTarget as HTMLElement).style.display = 'none';
      }}
    />
  {/if}
{/snippet}

<svelte:window onclick={() => (isPollDropdownOpen = false)} />

<main class="apple-shell">
  <!-- sticky top header and navigation -->
  <div class="apple-top-sticky">
    <header class="apple-header">
      <div class="brand" title="Web Deck">
        <svg class="brand-logo" viewBox="424 403 712 320" fill="currentColor">
          <path d="M832.07 404.86c.01.88.46 1.26 1.36 1.16 3.02-.49 6.05-.49 9.07.01 7.67-.15 15.34-.15 23 .01a19.6 19.6 0 0 1 8 0c35.67-.08 71.33-.08 107 .02 3.2-.45 6.42-.57 9.65-.36 43.23 2.09 82.8 23.9 109.61 57.54.29.38.59.75.91 1.11.74.93 1.44 1.88 2.12 2.86.23.33.45.66.66 1 43.65 59.14 41.76 145.79-6.79 201.46-.33.34-.64.69-.94 1.04-4.7 5.32-9.71 10.31-15.05 14.98-.29.24-.58.47-.87.7-.99.82-2 1.61-3.04 2.38-.31.23-.64.46-.96.69q-2.025 1.65-4.08 3.27c-.3.25-.61.49-.93.71-.98.82-2.01 1.58-3.08 2.28-.31.22-.62.43-.94.63-25.91 17.1-54.19 25.29-85.27 24.6-37.67-.02-75.33-.01-113 .04-2.7.06-5.35-.14-7.93-.59.37-.44.73-.88 1.09-1.34.13-.27.27-.54.42-.8 5.22-10.61 13.52-21.68 19.51-32.04.2-.34.41-.68.63-1.01 2.43-4.02 4.89-8.02 7.39-11.99.19-.34.4-.67.61-1 .45-.68.91-1.34 1.4-1.99.2-.33.41-.65.64-.97 1.74-3.06 11.67-19.94 13.46-20.99 21.26-.13 42.52-.18 63.78-.14 18.1.31 32.85-5.02 47.77-14.87.31-.22.63-.45.95-.66l4.1-3.29c.35-.31.69-.63 1.01-.97 3.14-2.86 6.16-5.84 9.05-8.94.32-.35.63-.72.92-1.09 9.24-11.49 15.36-24.44 18.39-38.86.2-3.11 2.16-7.5 1-10.43 2.46-1 .91-4.56.95-6.52.31-2.99.39-5.99.24-8.99-.05-.77-.44-1.27-1.16-1.5 1.51-9.6-8.08-33.08-14.45-41.29-.23-.31-.45-.62-.66-.95a92 92 0 0 0-3.31-4.08c-.4-.39-.89-.58-1.45-.56a2 2 0 0 0-.49-1.47c-2.26-2.6-4.71-5.01-7.33-7.24-.23-.18-.47-.36-.7-.54-11.88-9.34-26.11-15.98-41.3-17.19-1.82-.34-3.67-.54-5.53-.59-3.34.19-6.67.15-10-.11-39.12 0-78.24-.03-117.36-.07a20.8 20.8 0 0 1-2.87-3.19c-.3-.37-.6-.74-.9-1.1-3.59-4.08-7.28-8.05-11.07-11.93-.31-.37-.62-.73-.94-1.08-1.68-1.98-3.38-3.94-5.08-5.9-.3-.36-.61-.71-.94-1.05a382 382 0 0 1-17.03-18.98c-.31-.35-.63-.7-.96-1.03a686 686 0 0 1-8.11-8.92c-.35-.4-.79-.6-1.33-.6 0-.48-.1-.93-.31-1.36-1.74-2.05-3.52-4.06-5.34-6.04-.31-.36-.63-.7-.96-1.03q-3.675-4.065-7.29-8.16c-.55-.48-.7-1.04-.47-1.68 8.65-1.01 39.71.4 45.53-1.01Zm-305.97 1.07c.44 2.63 4.26 7.72 5.67 10.29.21.33.42.67.61 1.01 17.49 28.6 35.41 57.07 52.43 85.95.21.34.41.69.61 1.04 9.83 15.53 19.47 31.19 28.93 46.95.47.47.98.5 1.53.1 2.79-3.01 5.6-6 8.43-8.98.37-.42.53-.91.48-1.48.57.03 1.07-.16 1.48-.54.37-.36.6-.78.67-1.29q.78-.135 1.35-.69c.39-.41.61-.9.65-1.47.53.03.98-.15 1.34-.52 20.13-20.36 40.26-40.71 60.4-61.05.77-.59 2.21-2.62 3.24-1.4.39-.01.79-.01 1.19 0 .01.56.23 1.02.65 1.37 4.78 4.23 9.42 8.59 13.93 13.1.33.34.66.66 1.02.97 3.33 3.01 6.66 6.02 9.98 9.04q.48.51.99.99.495.495 1.02.96c9.38 8.63 18.7 17.32 27.97 26.06.33.33.68.64 1.04.95 4.02 3.65 8 7.33 11.96 11.05.33.34.67.66 1.02.97.35.32.69.64 1.01.98q.495.51 1.02.99c4.18 4.17 8.5 8.18 12.96 12.05.33.33.67.66 1.02.96 4.6 4.41 9.24 8.76 13.93 13.07.36.31.72.62 1.1.91 3.22 3.12 6.52 6.15 9.92 9.09.41.35.88.52 1.43.52.02.55.23 1.02.62 1.4 4.06 3.61 8.02 7.32 11.87 11.14.38.29.76.58 1.14.88 1.8 1.31 3.52 2.72 5.15 4.25.63.18 1.13 0 1.51-.54 16.41-24.8 31.61-50.42 47.62-75.47.8-.35 1.63-.49 2.5-.42 27.11-.04 54.21.05 81.31.26 1.18.14 1.64.78 1.39 1.93-.98 2.32-2.25 4.48-3.79 6.47-.2.34-.41.67-.63 1-6.26 9.58-12.38 19.25-18.37 29-.2.33-.42.66-.64.98-26.25 42.35-53.03 84.66-79.38 127.01q-.285.51-.63.99c-2.09 3.35-4.22 6.69-6.37 10.01-.2.33-.41.66-.64.98-4.28 7.18-8.65 14.3-13.1 21.38-.78 1.05-1.64 1.11-2.59.21-10.2-10.26-20.42-20.5-30.67-30.71-.34-.32-.69-.65-1.03-.98-1.03-.97-2.04-1.96-3.05-2.97-.4-.37-.87-.55-1.42-.52.02-.41-.07-.79-.26-1.15-2.12-2.2-4.27-4.38-6.44-6.53-.17-.17-.34-.33-.5-.49a43 43 0 0 1-2.35-2.32c-.33-.34-.67-.66-1.03-.97q-2.13-2.01-4.14-4.14c-.19-.19-.38-.38-.57-.56-.88-.84-1.75-1.69-2.6-2.56-.37-.21-.77-.3-1.2-.29.03-.55-.14-1.03-.5-1.44-.43-.36-.92-.51-1.49-.44.02-.68-.3-1.02-.97-1.05-.04-.69-.41-1.04-1.12-1.02.1-.57-.03-1.08-.4-1.52-.33-.34-.66-.68-1-1.01-.32-.33-.66-.65-1-.96-16.33-16.01-32.65-32.04-48.94-48.09-.43-.35-.93-.5-1.48-.45.02-.58-.17-1.08-.55-1.51-.35-.32-.69-.65-1.01-1q-.48-.51-.99-.99c-.33-.34-.67-.67-1-1.01s-.67-.68-1-1.01c-.33-.34-.67-.67-1.01-.98-.43-.45-.86-.89-1.29-1.34-.36-.13-.72-.2-1.1-.2-.12-.65-.51-1.01-1.17-1.07-.01-.6-.32-.9-.93-.89a1.9 1.9 0 0 0-.56-1.44c-3.23-3.21-6.55-6.32-9.95-9.34q-.705-.15-1.23.33c-1.86 1.94-3.67 3.93-5.44 5.95-.33.34-.64.68-.94 1.05-2.4 2.59-4.76 5.23-7.07 7.91q-.495.51-.96 1.05a284 284 0 0 0-14.03 14.99c-.32.34-.64.69-.94 1.05-6.68 7.32-13.36 14.64-20.05 21.96q-.495.495-.96 1.02c-3.41 3.6-6.77 7.25-10.07 10.95q-.48.525-.93 1.05a237 237 0 0 0-9.04 9.98c-.33.33-.65.68-.96 1.03-2.74 2.93-5.44 5.91-8.08 8.93-.32.34-.64.68-.95 1.03-3.34 3.66-6.7 7.3-10.1 10.9a2.06 2.06 0 0 0-.31 1.65c-.72-.05-1.11.28-1.18 1-.54-.05-.99.11-1.36.5-.98.78-3.09 3.95-4.22 4.01-1.62-2.17-3.1-4.46-4.46-6.88-.19-.3-.39-.6-.58-.9-.51-.68-1-1.38-1.46-2.09-.19-.3-.35-.61-.5-.94a638 638 0 0 0-11.25-18.17c-.21-.32-.41-.65-.6-.98-2.57-3.94-5.04-7.94-7.43-12-.2-.33-.39-.66-.57-1a62 62 0 0 1-2.46-3.96c-.2-.34-.4-.68-.59-1.03-2.47-4-4.93-8-7.39-12-.19-.33-.38-.67-.57-1.01-2.45-4.01-4.92-8.01-7.43-11.99-.21-.33-.4-.66-.58-1.01-3.08-5.03-6.22-10.03-9.42-14.98-.19-.34-.38-.68-.57-1.01-9.01-15.09-18.15-30.09-27.42-45.01-.21-.32-.4-.66-.58-1a287 287 0 0 1-8.42-14c-.21-.32-.42-.65-.6-.99q-2.28-3.45-4.38-7.02c-.21-.32-.41-.65-.61-.98-1.25-1.94-2.47-3.9-3.65-5.89-.19-.32-.37-.65-.54-.98a5635 5635 0 0 0-20.24-33.12c-.21-.33-.41-.67-.59-1.01-.89-1.28-1.7-2.6-2.42-3.98-.19-.34-.38-.68-.56-1.03-5.19-8.3-10.32-16.64-15.4-25q-.315-.495-.6-.99c-7.93-12.94-15.81-25.9-23.63-38.9-.21-.31-.4-.64-.59-.97a46 46 0 0 1-4.2-7.12c-.19-.34-.38-.67-.57-1.01-.89-1.28-1.7-2.61-2.44-3.98-.21-.33-.42-.68-.61-1.02-.44-.69-.89-1.37-1.33-2.05l-.36-.75c-.22-.43-.54-.77-.96-1 .35-2.32 6.08-.96 7.55-.96 6 .05 11.99-.07 17.98-.36 1.33.16 2.68.29 4.02.36a212 212 0 0 0 14.05-.37c1.31.16 2.63.29 3.95.4 17.53-.07 35.07-.11 52.6-.12Z"/>
        </svg>
      </div>

      <div class="header-actions">
        <button
          class="icon-btn"
          onclick={() => openExternalUrl(`https://github.com/${settingsState?.github?.repo || 'versenilvis/web-deck'}`)}
          title="GitHub Repository"
        >
          <svg class="action-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
        </button>


        <label class="apple-switch" title="Toggle extension globally">
          <input
            type="checkbox"
            bind:checked={globalEnabled}
            onchange={persist}
          />
          <span class="apple-slider"></span>
        </label>
      </div>
    </header>

    <!-- apple segmented control -->
    <nav class="segmented-control">
      <button
        class="segment"
        class:active={currentTab === 'general'}
        onclick={() => (currentTab = 'general')}
      >
        Overview
      </button>
      <button
        class="segment"
        class:active={currentTab === 'modules'}
        onclick={() => (currentTab = 'modules')}
      >
        Modules
      </button>
      <button
        class="segment"
        class:active={currentTab === 'css'}
        onclick={() => (currentTab = 'css')}
      >
        CSS
      </button>
      <button
        class="segment"
        class:active={currentTab === 'js'}
        onclick={() => (currentTab = 'js')}
      >
        JS
      </button>
      <button
        class="segment"
        class:active={currentTab === 'github'}
        onclick={() => (currentTab = 'github')}
      >
        Update
      </button>
    </nav>
  </div>

  <!-- body contents -->
  <div class="apple-body">
    {#if currentTab === 'general'}
      <!-- current site hero card -->
      <div class="apple-group">
        <div class="hero-row">
          <div class="identity">
            {@render siteIcon(currentDomain, '1.85rem')}
            <div class="meta">
              <span class="domain-name">{currentDomain || 'Unknown Site'}</span>
              <span class="domain-status">{isSiteActive(currentDomain) ? 'Active' : 'Disabled'}</span>
            </div>
          </div>

          <label class="apple-switch" title="Toggle {currentDomain}">
            <input
              type="checkbox"
              bind:checked={siteEnabled}
              onchange={() => toggleSite(currentDomain, siteEnabled)}
            />
            <span class="apple-slider"></span>
          </label>
        </div>

        <div class="action-bar">
          <button class="action-link" onclick={() => selectSiteForEdit(currentDomain)}>
            Edit CSS
          </button>
          <span class="divider">/</span>
          <button class="action-link" onclick={reloadBuiltinPreset}>
            Reset Preset
          </button>
        </div>
      </div>

      <!-- youtube inline options: feature modules & live chat -->
      {#if currentDomain === 'youtube.com'}
        <!-- youtube modules directly on overview -->
        <div class="apple-group">
          <div class="group-header">
            <span class="group-title">YouTube Modules</span>
            <div class="links">
              <button class="text-link" onclick={() => setAllModules('youtube.com', true)}>All On</button>
              <span class="divider">/</span>
              <button class="text-link" onclick={() => setAllModules('youtube.com', false)}>All Off</button>
            </div>
          </div>

          <div class="rows">
            {#if siteModulesMeta['youtube.com']}
              {#each siteModulesMeta['youtube.com'] as mod}
                <div class="item-row">
                  <div class="item-info">
                    <div class="item-name">{mod.label}</div>
                    <div class="item-caption">{mod.description}</div>
                  </div>
                  <label class="apple-switch switch-sm" title="Toggle {mod.label}">
                    <input
                      type="checkbox"
                      checked={isModuleActive('youtube.com', mod.id)}
                      onchange={(e) => toggleModule('youtube.com', mod.id, e.currentTarget.checked)}
                    />
                    <span class="apple-slider"></span>
                  </label>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- youtube live chat resizer and minimalist toggles -->
        <div class="apple-group">
          <div class="group-header">
            <span class="group-title">YouTube Live Chat</span>
            <label class="apple-switch" title="Toggle Live Chat resizer">
              <input
                type="checkbox"
                bind:checked={ytChatEnabled}
                onchange={persist}
              />
              <span class="apple-slider"></span>
            </label>
          </div>

          <div class="stats-line">
            <span class="stat-item">Width: <strong>{ytChatWidth}px</strong></span>
            <span class="divider">•</span>
            <span class="stat-item">Height: <strong>{typeof ytChatHeight === 'number' ? `${ytChatHeight}px` : ytChatHeight}</strong></span>
            <span class="divider">•</span>
            <span class="stat-item">Scale: <strong>{Math.round((settingsState?.ytChat?.scale || ytChatScale || 1) * 100)}%</strong></span>
            <button class="mini-btn ml-auto" onclick={resetChatSize}>Reset</button>
          </div>

          <div class="rows">
            <div class="item-row">
              <div class="item-info">
                <div class="item-name">Hide Top Header</div>
                <div class="item-caption">Hides top bar and view count (#chat-messages &gt; header)</div>
              </div>
              <label class="apple-switch switch-sm" title="Hide top bar">
                <input
                  type="checkbox"
                  bind:checked={ytChatHideHeader}
                  onchange={persist}
                />
                <span class="apple-slider"></span>
              </label>
            </div>

            <div class="item-row">
              <div class="item-info">
                <div class="item-name">Hide Chat Input</div>
                <div class="item-caption">Minimalist mode without input panel (#input-panel)</div>
              </div>
              <label class="apple-switch switch-sm" title="Hide chat input">
                <input
                  type="checkbox"
                  bind:checked={ytChatHideInput}
                  onchange={persist}
                />
                <span class="apple-slider"></span>
              </label>
            </div>
          </div>
        </div>
      {:else if siteModulesMeta[currentDomain]}
        <!-- other site modules on overview screen directly -->
        <div class="apple-group">
          <div class="group-header">
            <span class="group-title">{currentDomain} Modules</span>
            <div class="links">
              <button class="text-link" onclick={() => setAllModules(currentDomain, true)}>All On</button>
              <span class="divider">/</span>
              <button class="text-link" onclick={() => setAllModules(currentDomain, false)}>All Off</button>
            </div>
          </div>

          <div class="rows">
            {#each siteModulesMeta[currentDomain] as mod}
              <div class="item-row">
                <div class="item-info">
                  <div class="item-name">{mod.label}</div>
                  <div class="item-caption">{mod.description}</div>
                </div>
                <label class="apple-switch switch-sm" title="Toggle {mod.label}">
                  <input
                    type="checkbox"
                    checked={isModuleActive(currentDomain, mod.id)}
                    onchange={(e) => toggleModule(currentDomain, mod.id, e.currentTarget.checked)}
                  />
                  <span class="apple-slider"></span>
                </label>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- all supported sites list -->
      <div class="apple-group">
        <div class="group-header">
          <span class="group-title">Supported Sites</span>
        </div>

        <div class="rows">
          {#each supportedSites as site}
            <div class="item-row">
              <div class="site-identity">
                {@render siteIcon(site, '1.35rem')}
                <div class="site-meta">
                  <span class="site-domain">{site}</span>
                  {#if currentDomain === site}
                    <span class="active-dot">•</span>
                  {/if}
                </div>
              </div>

              <div class="site-controls">
                <button
                  class="action-link"
                  onclick={() => selectSiteForEdit(site)}
                  title="Edit CSS for {site}"
                >
                  Edit CSS
                </button>
                <label class="apple-switch switch-sm" title="Toggle {site}">
                  <input
                    type="checkbox"
                    checked={isSiteActive(site)}
                    onchange={(e) => toggleSite(site, e.currentTarget.checked)}
                  />
                  <span class="apple-slider"></span>
                </label>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else if currentTab === 'modules'}
      <!-- modules browser tab -->
      <div class="apple-group">
        <div class="chips-row">
          {#each supportedSites as site}
            <button
              class="chip-btn"
              class:active={selectedDomain === site}
              onclick={() => (selectedDomain = site)}
            >
              {@render siteIcon(site, '1rem')}
              <span>{site}</span>
            </button>
          {/each}
        </div>

        <div class="group-header">
          <span class="group-title">{selectedDomain} Modules</span>
          <div class="links">
            <button class="text-link" onclick={() => setAllModules(selectedDomain, true)}>All On</button>
            <span class="divider">/</span>
            <button class="text-link" onclick={() => setAllModules(selectedDomain, false)}>All Off</button>
          </div>
        </div>

        <div class="rows">
          {#if siteModulesMeta[selectedDomain]}
            {#each siteModulesMeta[selectedDomain] as mod}
              <div class="item-row">
                <div class="item-info">
                  <div class="item-name">{mod.label}</div>
                  <div class="item-caption">{mod.description}</div>
                </div>
                <label class="apple-switch switch-sm" title="Toggle {mod.label}">
                  <input
                    type="checkbox"
                    checked={isModuleActive(selectedDomain, mod.id)}
                    onchange={(e) => toggleModule(selectedDomain, mod.id, e.currentTarget.checked)}
                  />
                  <span class="apple-slider"></span>
                </label>
              </div>
            {/each}
          {:else}
            <div class="empty-text">No modular components for {selectedDomain}</div>
          {/if}
        </div>
      </div>
    {:else if currentTab === 'css'}
      <!-- css editor tab -->
      <div class="apple-group">
        <div class="chips-row">
          {#each supportedSites as site}
            <button
              class="chip-btn"
              class:active={selectedDomain === site}
              onclick={() => selectSiteForEdit(site)}
            >
              {@render siteIcon(site, '1rem')}
              <span>{site}</span>
            </button>
          {/each}
        </div>

        <div class="group-header">
          <span class="group-title">CSS: {selectedDomain}</span>
          <button class="action-link" onclick={reloadBuiltinPreset}>
            Reset Preset
          </button>
        </div>

        <textarea
          class="apple-editor"
          bind:value={customCss}
          oninput={onCssInput}
          placeholder={cssPlaceholder}
          spellcheck="false"
        ></textarea>

        <div class="footer-row">
          <button class="apple-btn flex-1" onclick={persist}>
            Save
          </button>
          <button
            class="apple-btn ghost"
            onclick={reloadBuiltinPreset}
          >
            Reset Preset
          </button>
        </div>
      </div>
    {:else if currentTab === 'js'}
      <!-- js editor tab -->
      <div class="apple-group">
        <div class="chips-row">
          {#each supportedSites as site}
            <button
              class="chip-btn"
              class:active={selectedDomain === site}
              onclick={() => selectSiteForEdit(site)}
            >
              {@render siteIcon(site, '1rem')}
              <span>{site}</span>
            </button>
          {/each}
        </div>

        <div class="group-header">
          <span class="group-title">JavaScript: {selectedDomain}</span>
        </div>

        <textarea
          class="apple-editor"
          bind:value={customJs}
          oninput={onJsInput}
          placeholder={jsPlaceholder}
          spellcheck="false"
        ></textarea>

        <div class="footer-row">
          <button class="apple-btn" onclick={persist}>
            Save & Run JS
          </button>
        </div>
      </div>
    {:else if currentTab === 'github'}
      <!-- update engine card -->
      <div class="apple-group">
        <div class="group-header">
          <div>
            <span class="group-title">Source Update</span>
            <div class="item-caption">
              {settingsState?.github?.repo || 'versenilvis/web-deck'} • main
            </div>
          </div>

          <label class="apple-switch" title="Toggle background auto-update">
            <input
              type="checkbox"
              bind:checked={githubAutoUpdate}
              onchange={persist}
            />
            <span class="apple-slider"></span>
          </label>
        </div>

        <div class="sync-bar">
          <button
            class="apple-btn flex-1"
            onclick={handleSyncGitHub}
            disabled={isSyncing}
          >
            {isSyncing ? 'Updating...' : 'Update from Source'}
          </button>

          <div class="interval-select-wrap">
            <span class="interval-label">Poll:</span>
            <div class="custom-dropdown-wrap">
              <button
                type="button"
                class="custom-dropdown-trigger"
                class:active={isPollDropdownOpen}
                onclick={(e) => {
                  e.stopPropagation();
                  isPollDropdownOpen = !isPollDropdownOpen;
                }}
              >
                <span>{pollIntervalOptions.find((o) => o.value === githubInterval)?.label || '15 min'}</span>
                <svg
                  class="dropdown-chevron"
                  class:rotate={isPollDropdownOpen}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {#if isPollDropdownOpen}
                <div
                  class="custom-dropdown-menu"
                  role="menu"
                  tabindex="-1"
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') isPollDropdownOpen = false;
                  }}
                >
                  {#each pollIntervalOptions as option}
                    <button
                      type="button"
                      class="custom-dropdown-item"
                      role="menuitem"
                      class:selected={githubInterval === option.value}
                      onclick={() => selectPollInterval(option.value)}
                    >
                      <span>{option.label}</span>
                      {#if githubInterval === option.value}
                        <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </div>

        <div class="status-box">
          <div class="status-row">
            <span class="status-label">Latest Commit</span>
            <button
              type="button"
              class="status-val commit-link-btn"
              onclick={() => {
                openExternalUrl(
                  lastSyncedCommit
                    ? `https://github.com/${settingsState?.github?.repo || 'versenilvis/web-deck'}/commit/${lastSyncedCommit}`
                    : `https://github.com/${settingsState?.github?.repo || 'versenilvis/web-deck'}/commits/main`,
                );
              }}
              title={lastSyncedCommit ? `View commit ${lastSyncedCommit} on GitHub` : 'View commits on GitHub'}
            >
              {lastSyncedCommit ? lastSyncedCommit.slice(0, 7) : 'Bundled release'}
            </button>
          </div>
          {#if lastSyncMessage}
            <div class="status-row">
              <span class="status-label">Commit Note</span>
              <span class="status-val truncate" title={lastSyncMessage}>{lastSyncMessage}</span>
            </div>
          {/if}
          {#if lastSyncedAt}
            <div class="status-row">
              <span class="status-label">Last Updated</span>
              <span class="status-val">{formatUsDateTime(lastSyncedAt)}</span>
            </div>
          {/if}
        </div>
      </div>

      <!-- about extension and credentials card -->
      <div class="apple-group">
        <div class="group-header">
          <div>
            <span class="group-title">About</span>
            <div class="item-caption">Web Deck v{extensionVersion}</div>
          </div>
        </div>

        <div class="rows">

          <div class="item-row">
            <div class="item-info">
              <div class="item-name">Author</div>
              <div class="item-caption">versenilvis</div>
            </div>
            <button
              type="button"
              class="action-link"
              onclick={() => openExternalUrl('https://github.com/versenilvis')}
            >
              Profile
            </button>
          </div>

          <div class="item-row">
            <div class="item-info">
              <div class="item-name">License</div>
              <div class="item-caption">GNU Affero General Public License v3</div>
            </div>
            <button
              type="button"
              class="action-link"
              onclick={() => openExternalUrl(`https://github.com/${settingsState?.github?.repo || 'versenilvis/web-deck'}/blob/main/LICENSE`)}
            >
              AGPL-3.0
            </button>
          </div>
        </div>
      </div>

      <!-- reset styles card -->
      <div class="apple-group">
        <div class="group-header">
          <div>
            <span class="group-title">Reset to Default</span>
            <div class="item-caption">Revert all site modifications to official presets</div>
          </div>
        </div>
        <div class="footer-row">
          <button class="apple-btn ghost danger-text" onclick={handleResetAllSites}>
            Reset All Styles
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- toast message -->
  {#if statusMessage}
    <div class="toast">{statusMessage}</div>
  {/if}
</main>

<style>
  /* root container */
  .apple-shell {
    padding: 0 1.15rem 1.45rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.95rem;
    background-color: var(--bg-primary);
  }

  /* sticky top header and nav */
  .apple-top-sticky {
    position: sticky;
    top: 0;
    z-index: 99;
    background: rgba(0, 0, 0, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    padding: 1.15rem 1.15rem 0.65rem 1.15rem;
    margin: 0 -1.15rem 0.25rem -1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  /* header */
  .apple-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.2rem 0.55rem 0.2rem;
  }

  .brand {
    display: flex;
    align-items: center;
  }

  .brand-logo {
    height: 1.45rem;
    width: auto;
    color: #ffffff;
    flex-shrink: 0;
    transition: opacity 0.2s ease, transform 0.2s ease;

    &:hover {
      opacity: 0.9;
      transform: scale(1.02);
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .action-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
  }

  .icon-btn {
    background: transparent;
    border: none;
    border-radius: 0;
    color: rgba(255, 255, 255, 0.88);
    width: auto;
    height: auto;
    padding: 0;
    margin: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
  }

  .icon-btn:hover {
    background: transparent;
    color: #ffffff;
  }


  /* segmented control */
  .segmented-control {
    display: flex;
    background: var(--apple-segment-bg);
    padding: 0.25rem;
    border-radius: var(--radius-md);
    gap: 0.25rem;
  }

  .segment {
    flex: 1;
    background: transparent;
    border: none;
    padding: 0.52rem 0;
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.18s ease;
    text-align: center;
  }

  .segment:hover {
    color: var(--text-primary);
  }

  .segment.active {
    background: var(--apple-segment-active);
    color: #ffffff;
    font-weight: 600;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  /* single-level grouped cards */
  .apple-body {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .apple-group {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 1.15rem 1.25rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  }

  /* hero current site */
  .hero-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.85rem;
  }

  .identity {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
  }

  .site-favicon {
    display: block;
    object-fit: contain;
    border-radius: 0.45rem;
    flex-shrink: 0;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .domain-name {
    font-size: 1.25rem;
    font-weight: 650;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .domain-status {
    font-size: 0.84rem;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .action-bar {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    margin-top: 0.85rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-subtle);
  }

  .action-link {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 0.84rem;
    font-weight: 500;
    cursor: pointer;
    padding: 0.2rem 0.45rem;
    border-radius: 0.4rem;
    transition: all 0.15s ease;
  }

  .action-link:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.06);
  }

  /* group header */
  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.65rem;
  }

  .group-title {
    font-size: 0.96rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .links {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .text-link {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .text-link:hover {
    color: #ffffff;
  }

  .divider {
    color: var(--text-tertiary);
    font-size: 0.78rem;
    font-weight: 400;
  }

  /* rows without nested backgrounds */
  .rows {
    display: flex;
    flex-direction: column;
  }

  .item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.8rem 0;
    border-top: 1px solid var(--border-subtle);
    gap: 0.85rem;
  }

  .item-row:first-child {
    border-top: none;
  }

  .item-info {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    min-width: 0;
  }

  .item-name {
    font-size: 0.95rem;
    font-weight: 550;
    color: var(--text-primary);
  }

  .item-caption {
    font-size: 0.83rem;
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.35;
  }

  /* live chat stats */
  .stats-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0 0.75rem 0;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }

  .stat-item {
    font-size: 0.82rem;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .stat-item strong {
    font-weight: 600;
    color: var(--text-primary);
  }

  .mini-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    font-size: 0.78rem;
    font-weight: 500;
    padding: 0.22rem 0.65rem;
    border-radius: 0.6rem;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .mini-btn:hover {
    border-color: rgba(255, 255, 255, 0.4);
  }

  .ml-auto {
    margin-left: auto;
  }

  /* site list row */
  .site-identity {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .site-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .site-domain {
    font-size: 0.96rem;
    font-weight: 550;
    color: var(--text-primary);
  }

  .active-dot {
    color: var(--apple-green);
    font-size: 0.78rem;
  }

  .site-controls {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  /* chips row */
  .chips-row {
    display: flex;
    gap: 0.45rem;
    overflow-x: auto;
    padding-bottom: 0.6rem;
    margin-bottom: 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .chip-btn {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    background: transparent;
    border: 1px solid var(--border-color);
    padding: 0.38rem 0.8rem;
    border-radius: 0.85rem;
    font-size: 0.84rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .chip-btn:hover {
    color: var(--text-primary);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .chip-btn.active {
    background: #ffffff;
    color: #000000;
    border-color: #ffffff;
    font-weight: 600;
  }

  /* editor */
  .apple-editor {
    width: 100%;
    min-height: 18rem;
    background: #000000;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 0.85rem;
    font-family: Menlo, Monaco, Consolas, monospace;
    font-size: 0.82rem;
    color: #ffffff;
    line-height: 1.45;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    margin-bottom: 0.65rem;
  }

  .apple-editor:focus {
    border-color: rgba(255, 255, 255, 0.3);
  }

  .footer-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .apple-btn {
    background: #ffffff;
    color: #000000;
    border: none;
    padding: 0.55rem 1.2rem;
    font-size: 0.88rem;
    font-weight: 600;
    border-radius: 0.75rem;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .apple-btn:hover {
    opacity: 0.9;
  }

  .apple-btn.ghost {
    background: transparent;
    border: 1px solid var(--border-color);
    color: #ffffff;
    font-weight: 500;
  }

  .apple-btn.ghost:hover {
    border-color: rgba(255, 255, 255, 0.3);
  }

  .flex-1 {
    flex: 1;
  }

  /* sync bar */
  .sync-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }

  .interval-select-wrap {
    display: flex;
    align-items: center;
    gap: 0.28rem;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .interval-label {
    font-size: 0.82rem;
    font-weight: 400;
  }

  /* custom sleek dropdown */
  .custom-dropdown-wrap {
    position: relative;
    display: inline-block;
  }

  .custom-dropdown-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border-color);
    border-radius: 0.65rem;
    color: var(--text-primary);
    padding: 0.42rem 0.65rem;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    min-width: 5.4rem;
  }

  .custom-dropdown-trigger:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.18);
  }

  .custom-dropdown-trigger.active {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
  }

  .dropdown-chevron {
    width: 0.85rem;
    height: 0.85rem;
    color: var(--text-secondary);
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    flex-shrink: 0;
  }

  .dropdown-chevron.rotate {
    transform: rotate(180deg);
  }

  .custom-dropdown-menu {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    min-width: 6.8rem;
    background: rgba(24, 24, 26, 0.95);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.75rem;
    padding: 0.28rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7), 0 0 1px rgba(255, 255, 255, 0.2);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    animation: dropdownIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes dropdownIn {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .custom-dropdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.4rem 0.6rem;
    background: transparent;
    border: none;
    border-radius: 0.45rem;
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .custom-dropdown-item:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .custom-dropdown-item.selected {
    color: #ffffff;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.07);
  }

  .check-icon {
    width: 0.82rem;
    height: 0.82rem;
    color: var(--apple-green);
    flex-shrink: 0;
  }

  .status-box {
    margin-top: 0.85rem;
    padding: 0.75rem 0.85rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.8rem;
  }

  .status-label {
    color: var(--text-secondary);
    font-weight: 400;
    flex-shrink: 0;
  }

  .status-val {
    color: var(--text-primary);
    font-weight: 500;
    font-family: ui-monospace, monospace;
    font-size: 0.74rem;
    text-align: right;
  }

  .status-val.truncate {
    max-width: 170px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* commit link button */
  .commit-link-btn {
    background: transparent;
    border: none;
    color: var(--apple-blue);
    cursor: pointer;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    text-align: right;
    transition: opacity 0.15s ease;
  }

  .commit-link-btn:hover {
    text-decoration: underline;
    opacity: 0.85;
  }

  .danger-text {
    color: #ff453a !important;
  }

  .danger-text:hover {
    background: rgba(255, 69, 58, 0.12) !important;
  }

  /* apple switch (ios green #30d158) */
  .apple-switch {
    position: relative;
    display: inline-block;
    width: 2.7rem;
    height: 1.55rem;
    flex-shrink: 0;
  }

  .apple-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .apple-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--apple-switch-off);
    transition: background-color 0.2s ease;
    border-radius: 1.55rem;
  }

  .apple-slider:before {
    position: absolute;
    content: "";
    height: 1.25rem;
    width: 1.25rem;
    left: 0.15rem;
    bottom: 0.15rem;
    background-color: #ffffff;
    transition: transform 0.2s ease;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }

  .apple-switch input:checked + .apple-slider {
    background-color: var(--apple-green);
  }

  .apple-switch input:checked + .apple-slider:before {
    transform: translateX(1.15rem);
  }

  .switch-sm {
    width: 2.4rem;
    height: 1.4rem;
  }

  .switch-sm .apple-slider:before {
    height: 1.1rem;
    width: 1.1rem;
  }

  .switch-sm input:checked + .apple-slider:before {
    transform: translateX(1rem);
  }

  /* toast */
  .toast {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: #ffffff;
    color: #000000;
    font-size: 0.82rem;
    font-weight: 700;
    padding: 0.5rem 1.1rem;
    border-radius: 1.4rem;
    z-index: 9999;
    white-space: nowrap;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
  }

  .empty-text {
    padding: 1rem 0;
    font-size: 0.82rem;
    font-weight: 400;
    color: var(--text-secondary);
    text-align: center;
  }
</style>
