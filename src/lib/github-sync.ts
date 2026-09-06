import { browser } from 'wxt/browser';
import { getSettings, saveSettings, type GitHubConfig } from './storage';

export interface SyncResult {
  success: boolean;
  updated: boolean;
  message: string;
  sha?: string;
}

export const SOURCE_REPO = 'versenilvis/web-deck';
export const SOURCE_BRANCH = 'main';

// clean repository string to owner/repo
function cleanRepo(repo?: string): string {
  if (!repo) return SOURCE_REPO;
  const cleaned = repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').trim();
  if (cleaned === 'versenilvis/chrome-beauty') return SOURCE_REPO;
  return cleaned || SOURCE_REPO;
}

// build headers for github api requests
function buildHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// check latest commit on repository branch
export async function checkLatestCommit(config?: Partial<GitHubConfig>): Promise<{ sha: string; shortSha: string; message: string } | null> {
  const repo = cleanRepo(config?.repo);
  const branch = config?.branch || SOURCE_BRANCH;
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(),
    });
    if (res.status === 404) {
      throw new Error(`Repository ${repo} not found or is private`);
    }
    if (res.status === 403) {
      throw new Error('GitHub API rate limit exceeded');
    }
    if (!res.ok) {
      throw new Error(`GitHub HTTP ${res.status}`);
    }

    const data = await res.json();
    const sha = data.sha || '';
    const message = data.commit?.message?.split('\n')[0] || '';
    return {
      sha,
      shortSha: sha.slice(0, 7),
      message,
    };
  } catch (err: any) {
    if (err.message && !err.message.includes('fetch')) {
      throw err;
    }
    return null;
  }
}

// map folder name in sites to actual domain keys
function mapFolderToDomains(folder: string): string[] {
  switch (folder) {
    case 'youtube':
      return ['youtube.com'];
    case 'github':
      return ['github.com'];
    case 'threads':
      return ['threads.net', 'threads.com'];
    case 'x':
    case 'twitter':
      return ['x.com', 'twitter.com'];
    case 'facebook':
      return ['facebook.com'];
    case 'messenger':
      return ['messenger.com'];
    default:
      return [folder.includes('.') ? folder : `${folder}.com`];
  }
}

// fetch content of a file from repository
async function fetchFileText(repo: string, branch: string, path: string, blobUrl?: string): Promise<string | null> {
  // try raw githubusercontent first
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${path}?cb=${Date.now()}`;
    const rawRes = await fetch(rawUrl);
    if (rawRes.ok) {
      return await rawRes.text();
    }
  } catch {}

  // fallback to github api raw blob
  if (blobUrl) {
    try {
      const blobRes = await fetch(blobUrl, {
        headers: {
          ...buildHeaders(),
          Accept: 'application/vnd.github.raw+json',
        },
      });
      if (blobRes.ok) {
        return await blobRes.text();
      }
    } catch {}
  }

  // fallback to contents api
  try {
    const contentUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
    const contentRes = await fetch(contentUrl, { headers: buildHeaders() });
    if (contentRes.ok) {
      const data = await contentRes.json();
      if (data.content && data.encoding === 'base64') {
        return decodeURIComponent(escape(atob(data.content.replace(/\s/g, ''))));
      }
    }
  } catch {}

  return null;
}

// download all css modules in sites folder from github
export async function fetchSiteStylesFromGitHub(config?: Partial<GitHubConfig>): Promise<Record<string, Record<string, string>>> {
  const repo = cleanRepo(config?.repo);
  const branch = config?.branch || SOURCE_BRANCH;
  const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;

  const res = await fetch(treeUrl, {
    method: 'GET',
    headers: buildHeaders(),
  });

  if (!res.ok) {
    throw new Error(`Failed to read repo tree: HTTP ${res.status}`);
  }

  const data = await res.json();
  const tree = (data.tree || []) as Array<{ path: string; type: string; url: string }>;

  // filter files matching sites/{site}/{module}.css
  const cssFiles = tree.filter(
    (item) => item.type === 'blob' && item.path.startsWith('sites/') && item.path.endsWith('.css'),
  );

  const resultMap: Record<string, Record<string, string>> = {};

  // fetch css contents concurrently
  await Promise.all(
    cssFiles.map(async (file) => {
      const parts = file.path.split('/');
      if (parts.length < 3) return;

      const folder = parts[1];
      const fileName = parts[2];
      if (!folder || !fileName) return;

      const moduleId = fileName.replace(/\.css$/, '');

      const text = await fetchFileText(repo, branch, file.path, file.url);
      if (text === null) return;

      const domains = mapFolderToDomains(folder);
      for (const domain of domains) {
        if (!resultMap[domain]) {
          resultMap[domain] = {};
        }
        resultMap[domain][moduleId] = text;
      }
    }),
  );

  return resultMap;
}

// broadcast asset reload to all open browser tabs
export async function broadcastReload() {
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { type: 'cb_reload_assets' }).catch(() => {});
      }
    }
  } catch {}

  try {
    browser.runtime.sendMessage({ type: 'cb_reload_assets' }).catch(() => {});
  } catch {}
}

// execute full sync from github repository
export async function syncWithGitHub(force = false): Promise<SyncResult> {
  const settings = await getSettings();
  const { github } = settings;

  if (!github.repo.trim()) {
    return { success: false, updated: false, message: 'Repository not configured' };
  }

  let latest: { sha: string; shortSha: string; message: string } | null = null;
  try {
    latest = await checkLatestCommit(github);
  } catch (err: any) {
    return { success: false, updated: false, message: err.message || 'Could not connect to GitHub' };
  }
  if (!latest) {
    return { success: false, updated: false, message: 'Could not connect to GitHub' };
  }

  if (!force && github.lastSyncedCommit === latest.sha) {
    return {
      success: true,
      updated: false,
      message: `Already up to date (${latest.shortSha})`,
      sha: latest.shortSha,
    };
  }

  try {
    const fetchedModules = await fetchSiteStylesFromGitHub(github);
    const siteCount = Object.keys(fetchedModules).length;

    if (siteCount === 0) {
      return { success: false, updated: false, message: 'No CSS files found in sites/' };
    }

    // merge with existing synced modules
    const merged = { ...(settings.syncedModules || {}) };
    for (const [site, mods] of Object.entries(fetchedModules)) {
      merged[site] = {
        ...(merged[site] || {}),
        ...mods,
      };
    }

    settings.syncedModules = merged;
    settings.github.lastSyncedCommit = latest.sha;
    settings.github.lastSyncedAt = Date.now();
    settings.github.lastSyncMessage = latest.message;

    await saveSettings(settings);
    await broadcastReload();

    return {
      success: true,
      updated: true,
      message: `Updated to ${latest.shortSha}: ${latest.message.slice(0, 35)}`,
      sha: latest.shortSha,
    };
  } catch (err: any) {
    return {
      success: false,
      updated: false,
      message: err.message || 'Failed to download styles from GitHub',
    };
  }
}
