import channelCardCss from '../../sites/youtube/channel-card.css?raw';

interface ChannelCardData {
  handle: string;
  name: string;
  avatarUrl: string;
  bannerUrl: string | null;
  statsText: string | null;
  description: string | null;
  linksText: string | null;
  isVerified: boolean;
  channelUrl: string;
}

interface CacheEntry {
  data: ChannelCardData;
  expiresAt: number;
}

// 1 hour cache ttl
const CACHE_TTL_MS = 60 * 60 * 1000;
const channelCache = new Map<string, CacheEntry>();

let popoverEl: HTMLElement | null = null;
let activeTarget: HTMLAnchorElement | null = null;
let activeChannelKey: string | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let isChannelCardActive = false;
let isMouseOverPopover = false;
let currentAbortController: AbortController | null = null;

// verified svg badge icon
const VERIFIED_ICON_SVG = `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.8 14.5l-4.2-4.2 1.4-1.4 2.8 2.8 6.8-6.8 1.4 1.4-8.2 8.2z"/>
</svg>`;

// external link svg icon
const LINK_ICON_SVG = `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
</svg>`;

// ensure channel card stylesheet is injected
function ensureStyle() {
  if (document.getElementById('cb-channel-card-style')) return;
  const style = document.createElement('style');
  style.id = 'cb-channel-card-style';
  style.textContent = channelCardCss;
  (document.head || document.documentElement).appendChild(style);
}

// traverse composed path to find channel link outside popover
function findChannelLink(e: MouseEvent): HTMLAnchorElement | null {
  const path = e.composedPath ? e.composedPath() : [e.target];

  // never trigger from elements inside the card itself
  for (const item of path) {
    if (item instanceof HTMLElement && item.classList.contains('cb-channel-card-popover')) {
      return null;
    }
  }

  for (const item of path) {
    if (item instanceof HTMLAnchorElement) {
      const rawHref = item.getAttribute('href') || item.href || '';
      if (rawHref.includes('/@') || rawHref.includes('/channel/UC')) {
        return item;
      }
    }
    if (item instanceof HTMLElement) {
      if (
        item.id === 'channel-name' ||
        item.id === 'avatar-link' ||
        item.tagName.toLowerCase() === 'ytd-channel-name' ||
        item.classList.contains('ytd-channel-name') ||
        (item.className && typeof item.className === 'string' && (
          item.className.includes('byline') ||
          item.className.includes('MetadataText') ||
          item.className.includes('MetadataRow')
        ))
      ) {
        const anchor = item.querySelector<HTMLAnchorElement>('a[href*="/@"], a[href*="/channel/UC"]') ||
                       item.closest<HTMLAnchorElement>('a[href*="/@"], a[href*="/channel/UC"]');
        if (anchor) return anchor;
      }
    }
  }
  return null;
}

// parse unicode and accented handle or channel id from link
function getChannelInfoFromLink(link: HTMLAnchorElement): { key: string; url: string; handle: string } | null {
  const rawHref = link.getAttribute('href') || link.href || '';
  if (!rawHref) return null;

  let href = rawHref;
  try {
    href = decodeURIComponent(rawHref);
  } catch {}

  // match /@handle with unicode accents and special symbols
  const handleMatch = href.match(/\/@([^\/\?\#\s]+)/);
  const rawHandle = handleMatch ? handleMatch[1] : null;
  if (rawHandle) {
    const cleanHandle = rawHandle.trim();
    const handle = `@${cleanHandle}`;
    return {
      key: handle.toLowerCase(),
      url: `https://www.youtube.com/${handle}`,
      handle,
    };
  }

  // match /channel/UC...
  const channelMatch = href.match(/\/channel\/(UC[a-zA-Z0-9_\-]+)/);
  const rawCid = channelMatch ? channelMatch[1] : null;
  if (rawCid) {
    const cid = rawCid.trim();
    return {
      key: cid,
      url: `https://www.youtube.com/channel/${cid}`,
      handle: '',
    };
  }

  return null;
}

// fetch and parse channel metadata directly on same-origin with abort support
async function fetchChannelData(channelUrl: string, fallbackHandle: string, signal: AbortSignal): Promise<ChannelCardData | null> {
  try {
    const resp = await fetch(channelUrl, { credentials: 'same-origin', signal });
    if (!resp.ok) return null;

    const html = await resp.text();
    const marker = 'var ytInitialData = ';
    const startIdx = html.indexOf(marker);
    if (startIdx === -1) return null;

    const endIdx = html.indexOf(';</script>', startIdx);
    if (endIdx === -1) return null;

    const jsonStr = html.substring(startIdx + marker.length, endIdx);
    const data = JSON.parse(jsonStr);

    const header = data?.header || {};
    const pageHeader = header.pageHeaderRenderer?.content?.pageHeaderViewModel;

    if (pageHeader) {
      const name = pageHeader.title?.dynamicTextViewModel?.text?.content || '';

      const avatarSources = pageHeader.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources;
      const avatarUrl = avatarSources && avatarSources.length ? avatarSources[avatarSources.length - 1].url : '';

      const bannerSources = pageHeader.banner?.imageBannerViewModel?.image?.sources;
      const bannerUrl = bannerSources && bannerSources.length ? bannerSources[bannerSources.length - 1].url : null;

      const metaRows = pageHeader.metadata?.contentMetadataViewModel?.metadataRows || [];
      let parsedHandle = fallbackHandle;
      let statsText: string | null = null;

      if (metaRows.length > 0) {
        const row0 = metaRows[0]?.metadataParts?.map((p: any) => p?.text?.content).filter(Boolean).join(' • ');
        if (row0 && row0.startsWith('@')) {
          parsedHandle = row0;
        }
      }

      if (metaRows.length > 1) {
        statsText = metaRows[1]?.metadataParts?.map((p: any) => p?.text?.content).filter(Boolean).join(' • ') || null;
      }

      const description = pageHeader.description?.descriptionPreviewViewModel?.description?.content || null;
      const linksText = pageHeader.attribution?.attributionViewModel?.text?.content?.trim() || null;

      const jsonDump = JSON.stringify(header);
      const isVerified = jsonDump.includes('CHECK_CIRCLE_FILLED') || jsonDump.includes('OFFICIAL_ARTIST');

      return {
        handle: parsedHandle,
        name,
        avatarUrl,
        bannerUrl,
        statsText,
        description,
        linksText,
        isVerified,
        channelUrl,
      };
    }

    // fallback for c4TabbedHeaderRenderer
    const c4 = header.c4TabbedHeaderRenderer;
    if (c4) {
      const name = c4.title || '';
      const avatarSources = c4.avatar?.thumbnails;
      const avatarUrl = avatarSources && avatarSources.length ? avatarSources[avatarSources.length - 1].url : '';
      const bannerSources = c4.banner?.thumbnails;
      const bannerUrl = bannerSources && bannerSources.length ? bannerSources[bannerSources.length - 1].url : null;
      const statsText = c4.subscriberCountText?.simpleText || null;

      return {
        handle: fallbackHandle,
        name,
        avatarUrl,
        bannerUrl,
        statsText,
        description: null,
        linksText: null,
        isVerified: Boolean(c4.badges?.length),
        channelUrl,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ensure popover element exists in body
function getOrCreatePopover(): HTMLElement {
  ensureStyle();

  if (popoverEl && document.body && document.body.contains(popoverEl)) {
    return popoverEl;
  }

  const el = document.createElement('div');
  el.className = 'cb-channel-card-popover';
  el.id = 'cb-channel-card-popover';

  // lock card visibility when mouse enters popover
  el.addEventListener('mouseenter', () => {
    isMouseOverPopover = true;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  });

  el.addEventListener('mouseleave', (e) => {
    isMouseOverPopover = false;
    const related = e.relatedTarget as Node | null;
    if (activeTarget && related && activeTarget.contains(related)) {
      return;
    }
    hidePopover(80);
  });

  (document.body || document.documentElement).appendChild(el);
  popoverEl = el;
  return el;
}

// smart positioning for popover avoiding screen edges
function positionPopover(target: HTMLElement, popover: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const popoverWidth = 320;
  const popoverHeight = popover.offsetHeight || 220;

  let top = rect.bottom + 8;
  if (top + popoverHeight > window.innerHeight - 16) {
    if (rect.top - popoverHeight - 8 > 16) {
      top = rect.top - popoverHeight - 8;
    } else {
      top = Math.max(16, window.innerHeight - popoverHeight - 16);
    }
  }

  let left = rect.left;
  if (left + popoverWidth > window.innerWidth - 16) {
    left = window.innerWidth - popoverWidth - 16;
  }
  if (left < 16) {
    left = 16;
  }

  popover.style.top = `${Math.round(top)}px`;
  popover.style.left = `${Math.round(left)}px`;
}

// render html content into card popover
function renderCardContent(popover: HTMLElement, data: ChannelCardData, isLoadingStats = false) {
  const bannerHtml = data.bannerUrl
    ? `<div class="cb-card-banner" style="background-image: url('${data.bannerUrl}')"></div>`
    : '';

  const verifiedHtml = data.isVerified
    ? `<span class="cb-card-badge" title="Verified">${VERIFIED_ICON_SVG}</span>`
    : '';

  let statsHtml = '';
  if (isLoadingStats) {
    statsHtml = `<div class="cb-card-stats"><span class="cb-card-skeleton cb-card-skeleton-stats"></span></div>`;
  } else if (data.statsText) {
    statsHtml = `<div class="cb-card-stats"><span class="cb-card-stats-text">${data.statsText}</span></div>`;
  }

  let bioHtml = '';
  if (isLoadingStats) {
    bioHtml = `
      <div class="cb-card-skeleton cb-card-skeleton-bio-1"></div>
      <div class="cb-card-skeleton cb-card-skeleton-bio-2"></div>
    `;
  } else if (data.description) {
    bioHtml = `<p class="cb-card-bio">${data.description}</p>`;
  }

  let linksHtml = '';
  if (!isLoadingStats && data.linksText) {
    linksHtml = `
      <a class="cb-card-links" href="${data.channelUrl}" target="_blank" rel="noopener">
        ${LINK_ICON_SVG}
        <span>${data.linksText}</span>
      </a>
    `;
  }

  popover.innerHTML = `
    ${bannerHtml}
    <div class="cb-card-body">
      <div class="cb-card-top">
        <div class="cb-card-avatar-wrap">
          <img class="cb-card-avatar" src="${data.avatarUrl}" alt="${data.name}" />
        </div>
        <a class="cb-card-visit-btn" href="${data.channelUrl}">
          Visit Channel
        </a>
      </div>
      <div class="cb-card-title-group">
        <div class="cb-card-name-row">
          <a class="cb-card-name" href="${data.channelUrl}">${data.name}</a>
          ${verifiedHtml}
        </div>
        ${data.handle ? `<span class="cb-card-handle">${data.handle}</span>` : ''}
      </div>
      ${statsHtml}
      ${bioHtml}
      ${linksHtml}
    </div>
  `;
}

// hide popover with quick clean exit
function hidePopover(delay = 80) {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (hideTimer) clearTimeout(hideTimer);

  hideTimer = setTimeout(() => {
    // never close while mouse is interacting inside popover
    if (isMouseOverPopover) return;

    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    if (popoverEl) {
      popoverEl.classList.remove('cb-visible');
    }
    activeTarget = null;
    activeChannelKey = null;
    hideTimer = null;
  }, delay);
}

// handle mouse enter on channel link
function onMouseOver(e: MouseEvent) {
  const target = findChannelLink(e);
  if (!target) return;

  const info = getChannelInfoFromLink(target);
  if (!info) return;

  // clear pending hide timer
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  // already active on this target
  if (activeTarget === target) {
    return;
  }

  activeTarget = target;
  activeChannelKey = info.key;

  if (showTimer) clearTimeout(showTimer);

  // 120ms debounce before displaying popover
  showTimer = setTimeout(async () => {
    if (activeTarget !== target || activeChannelKey !== info.key) return;

    const popover = getOrCreatePopover();

    // check cache first
    const cached = channelCache.get(info.key);
    if (cached && cached.expiresAt > Date.now()) {
      renderCardContent(popover, cached.data, false);
      positionPopover(target, popover);
      popover.classList.add('cb-visible');
      return;
    }

    // extract instant fallback info from dom
    const container = target.closest('ytd-rich-grid-media, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-watch-metadata, yt-lockup-view-model, #dismissible') || target.parentElement;
    const name = target.textContent?.trim() || target.getAttribute('title') || info.handle;

    let avatarUrl = '';
    const imgEl = container?.querySelector<HTMLImageElement>(
      '#avatar-link img, #avatar img, yt-img-shadow img, img.yt-core-image, yt-decorated-avatar-view-model img'
    );
    if (imgEl && imgEl.src && !imgEl.src.includes('data:image')) {
      avatarUrl = imgEl.src;
    }

    const isVerified = Boolean(
      container?.querySelector('[aria-label*="Verified" i], [aria-label*="Xác minh" i], ytd-badge-supported-renderer, .badge-style-type-verified')
    );

    const instantData: ChannelCardData = {
      handle: info.handle,
      name,
      avatarUrl,
      bannerUrl: null,
      statsText: null,
      description: null,
      linksText: null,
      isVerified,
      channelUrl: info.url,
    };

    // render instant skeleton card
    renderCardContent(popover, instantData, true);
    positionPopover(target, popover);
    popover.classList.add('cb-visible');

    // abort any ongoing previous channel fetch
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();

    // fetch full details in background without preloading
    const fullData = await fetchChannelData(info.url, info.handle, currentAbortController.signal);
    if (fullData) {
      channelCache.set(info.key, {
        data: fullData,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      // update if still hovered on this channel
      if (activeTarget === target && activeChannelKey === info.key && popover.classList.contains('cb-visible')) {
        renderCardContent(popover, fullData, false);
        positionPopover(target, popover);
      }
    } else {
      if (activeTarget === target && activeChannelKey === info.key && popover.classList.contains('cb-visible')) {
        renderCardContent(popover, instantData, false);
      }
    }
  }, 120);
}

// handle mouse exit from channel link
function onMouseOut(e: MouseEvent) {
  if (!activeTarget) return;

  const related = e.relatedTarget as Node | null;
  // ignore if moving to child inside target or into popover
  if (related && activeTarget.contains(related)) {
    return;
  }
  if (popoverEl && related && popoverEl.contains(related)) {
    return;
  }

  hidePopover(80);
}

// close card immediately on scroll
function onWindowScroll() {
  if (!isMouseOverPopover && popoverEl?.classList.contains('cb-visible')) {
    hidePopover(0);
  }
}

// initialize channel hover badge
export function setupYtChannelCard() {
  if (isChannelCardActive) return;
  isChannelCardActive = true;

  ensureStyle();
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  window.addEventListener('scroll', onWindowScroll, { passive: true });
}

// clean up listeners and popover
export function removeYtChannelCard() {
  if (!isChannelCardActive) return;
  isChannelCardActive = false;

  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('mouseout', onMouseOut, true);
  window.removeEventListener('scroll', onWindowScroll);

  if (showTimer) clearTimeout(showTimer);
  if (hideTimer) clearTimeout(hideTimer);
  if (currentAbortController) currentAbortController.abort();

  if (popoverEl) {
    popoverEl.remove();
    popoverEl = null;
  }
  activeTarget = null;
  activeChannelKey = null;
  isMouseOverPopover = false;
}
