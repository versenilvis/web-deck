import { youtubeCss, youtubeLiveChatCss, youtubeModules } from './youtube';
import { githubCss, githubModules } from './github';
import { xCss, xModules } from './x';
import { facebookCss, facebookModules } from './facebook';
import { messengerCss, messengerModules } from './messenger';
import { threadsCss, threadsModules } from './threads';

export const siteStyles: Record<string, string> = {
  'youtube.com': youtubeCss,
  'threads.com': threadsCss,
  'github.com': githubCss,
  'x.com': xCss,
  'facebook.com': facebookCss,
  'messenger.com': messengerCss,
};

export const liveChatFrameCss = youtubeLiveChatCss;

export const siteModules = {
  youtube: youtubeModules,
  github: githubModules,
  x: xModules,
  facebook: facebookModules,
  messenger: messengerModules,
  threads: threadsModules,
};

export interface ModuleItem {
  id: string;
  label: string;
  description: string;
  css: string;
}

export const siteModulesMeta: Record<string, ModuleItem[]> = {
  'youtube.com': [
    { id: 'layout', label: 'Top Bar Layout', description: 'Curved dark top bar and clean scrollbar', css: youtubeModules.layout },
    { id: 'theater', label: 'Theater & Autohide Navbar', description: 'Full window view and autohiding top navbar', css: youtubeModules.theater },
    { id: 'guide', label: 'Sidebar Guide', description: 'Transparent floating navigation drawer', css: youtubeModules.guide },
    { id: 'header', label: 'Header & Chips', description: 'Minimalist header with cleaned tags', css: youtubeModules.header },
    { id: 'feed', label: 'Feed & Thumbnails', description: 'Curved video cards and previews', css: youtubeModules.feed },
    { id: 'watch', label: 'Watch Layout', description: 'Optimized player and comment styles', css: youtubeModules.watch },
    { id: 'search', label: 'Searchbox', description: 'Minimal glowing search bar', css: youtubeModules.search },
    { id: 'player', label: 'Player Controls', description: 'Floating glass controls and timestamps', css: youtubeModules.player },
    { id: 'optimize', label: 'Performance & Fast Player', description: 'Prioritize video player, defer comments/playlists, instant F fullscreen', css: youtubeModules.optimize },
  ],
  'github.com': [
    { id: 'glass', label: 'Glassmorphism', description: 'Subtle borders and frosted panels', css: githubModules.glass },
    { id: 'hover', label: 'Hover Highlights', description: 'Smooth row and tab highlights', css: githubModules.hover },
    { id: 'extras', label: 'Extras', description: 'Profile contributions and repo refinements', css: githubModules.extras },
  ],
  'threads.com': [
    { id: 'transparency', label: 'Transparency', description: 'Transparent column feed and cards', css: threadsModules.transparency },
    { id: 'layout', label: 'Curved Arches Layout', description: 'Signature corner arches and top border', css: threadsModules.layout },
  ],
  'x.com': [
    { id: 'transparency', label: 'Transparency', description: 'Ultra clean transparent timeline', css: xModules.transparency },
    { id: 'layout', label: 'Layout Tweaks', description: 'Refined sidebar and post layout', css: xModules.layout },
  ],
  'messenger.com': [
    { id: 'transparency', label: 'Transparency', description: 'Glassy transparent chat surfaces', css: messengerModules.transparency },
    { id: 'sidebar', label: 'Sidebar Layout', description: 'Clean streamlined conversation list', css: messengerModules.sidebar },
  ],
  'facebook.com': [
    { id: 'transparency', label: 'Transparency', description: 'Transparent feed cards and header bar', css: facebookModules.transparency },
  ],
};

// extract primary domain name from full hostname
export function resolveDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length >= 2) {
    const domain = parts.slice(-2).join('.');
    if (domain === 'threads.net') return 'threads.com';
    if (domain === 'twitter.com') return 'x.com';
    return domain;
  }
  return hostname;
}

// retrieve builtin css or assemble from selected modules, preferring synced github modules
export function getBuiltinCss(
  domain: string,
  modulesState?: Record<string, boolean>,
  syncedModules?: Record<string, Record<string, string>>,
): string | null {
  const metaList = siteModulesMeta[domain];
  const siteSynced = syncedModules?.[domain];

  if (!metaList) {
    return siteStyles[domain] || null;
  }

  return metaList
    .filter((mod) => !modulesState || modulesState[mod.id] !== false)
    .map((mod) => (siteSynced && siteSynced[mod.id] ? siteSynced[mod.id] : mod.css))
    .join('\n\n');
}
