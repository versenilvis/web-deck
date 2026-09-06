let isOptimizerActive = false;
let fsTimer: ReturnType<typeof setTimeout> | null = null;
let userHasScrolled = false;
let isScrollLocked = false;
let scrollLockTimer: ReturnType<typeof setTimeout> | null = null;

// check if user is currently typing in an input or comment box
function isTypingContext(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.closest('ytd-searchbox, #search-form, #search-input, yt-live-chat-message-input-renderer, #comment-dialog, #reply-dialog, yt-comments, [contenteditable="true"]')) {
    return true;
  }
  return false;
}

// instant fullscreen handler capturing f key before native event queue
function onKeyDown(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'f' && e.key !== 'F') return;

  const target = (e.composedPath ? e.composedPath()[0] : e.target) as Element | null;
  const active = document.activeElement;

  if (isTypingContext(target) || isTypingContext(active)) {
    return;
  }

  const player = (document.getElementById('movie_player') || document.querySelector('.html5-video-player')) as any;
  if (player) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (typeof player.toggleFullscreen === 'function') {
      player.toggleFullscreen();
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      player.requestFullscreen().catch(() => {});
    }
  }
}

// eliminate frame drops by disabling lingering transitions during fullscreen toggle
function onFullscreenChange() {
  document.documentElement.classList.add('cb-fullscreen-toggling');
  if (fsTimer) clearTimeout(fsTimer);
  fsTimer = setTimeout(() => {
    document.documentElement.classList.remove('cb-fullscreen-toggling');
    fsTimer = null;
  }, 160);
}

// lock scroll at top when opening or navigating to video
function lockScrollToTop() {
  if (!window.location.pathname.startsWith('/watch')) return;
  userHasScrolled = false;
  isScrollLocked = true;

  try {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  } catch {}

  window.scrollTo(0, 0);
  if (document.documentElement) document.documentElement.scrollTop = 0;
  if (document.body) document.body.scrollTop = 0;

  if (scrollLockTimer) clearTimeout(scrollLockTimer);
  const startTime = Date.now();

  const enforceTop = () => {
    if (userHasScrolled || !window.location.pathname.startsWith('/watch')) {
      isScrollLocked = false;
      return;
    }
    if (window.scrollY !== 0) {
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    }
    if (Date.now() - startTime < 1500) {
      scrollLockTimer = setTimeout(enforceTop, 40);
    } else {
      isScrollLocked = false;
    }
  };

  scrollLockTimer = setTimeout(enforceTop, 40);
}

// detect real user scroll interaction
function onUserScrollIntent(e: Event) {
  if (e.type === 'wheel' || e.type === 'touchmove') {
    userHasScrolled = true;
    isScrollLocked = false;
    if (scrollLockTimer) clearTimeout(scrollLockTimer);
  } else if (e.type === 'keydown') {
    const key = (e as KeyboardEvent).key;
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Space', 'Home', 'End'].includes(key)) {
      userHasScrolled = true;
      isScrollLocked = false;
      if (scrollLockTimer) clearTimeout(scrollLockTimer);
    }
  }
}

// guard against programmatic auto scroll from youtube on video load
function onWindowScroll() {
  if (isScrollLocked && !userHasScrolled && window.location.pathname.startsWith('/watch')) {
    if (window.scrollY > 0) {
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    }
  }
}

// prioritize video player rendering on spa navigation
function onNavigateStart() {
  const player = document.querySelector<HTMLElement>('#ytd-player, #movie_player');
  if (player) {
    player.style.setProperty('contain', 'layout paint style', 'important');
  }
  lockScrollToTop();
}

function onNavigateFinish() {
  const player = document.querySelector<HTMLElement>('#ytd-player, #movie_player');
  if (player) {
    player.style.removeProperty('contain');
  }
  lockScrollToTop();
}

function onPageDataUpdated() {
  if (!userHasScrolled) {
    lockScrollToTop();
  }
}

function onPopState() {
  if (window.location.pathname.startsWith('/watch')) {
    lockScrollToTop();
  }
}

// initialize youtube performance optimizer
export function setupYtOptimizer() {
  if (isOptimizerActive) return;
  isOptimizerActive = true;

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('wheel', onUserScrollIntent, { passive: true, capture: true });
  window.addEventListener('touchmove', onUserScrollIntent, { passive: true, capture: true });
  window.addEventListener('keydown', onUserScrollIntent, { passive: true, capture: true });
  window.addEventListener('scroll', onWindowScroll, { passive: true });
  window.addEventListener('popstate', onPopState, { passive: true });
  document.addEventListener('fullscreenchange', onFullscreenChange, { passive: true });
  window.addEventListener('yt-navigate-start', onNavigateStart, { passive: true });
  window.addEventListener('yt-navigate-finish', onNavigateFinish, { passive: true });
  window.addEventListener('yt-page-data-updated', onPageDataUpdated, { passive: true });

  if (window.location.pathname.startsWith('/watch')) {
    lockScrollToTop();
  }
}

// remove optimizer listeners
export function removeYtOptimizer() {
  if (!isOptimizerActive) return;
  isOptimizerActive = false;

  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('wheel', onUserScrollIntent, true);
  window.removeEventListener('touchmove', onUserScrollIntent, true);
  window.removeEventListener('keydown', onUserScrollIntent, true);
  window.removeEventListener('scroll', onWindowScroll);
  window.removeEventListener('popstate', onPopState);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  window.removeEventListener('yt-navigate-start', onNavigateStart);
  window.removeEventListener('yt-navigate-finish', onNavigateFinish);
  window.removeEventListener('yt-page-data-updated', onPageDataUpdated);

  if (fsTimer) {
    clearTimeout(fsTimer);
    fsTimer = null;
  }
  if (scrollLockTimer) {
    clearTimeout(scrollLockTimer);
    scrollLockTimer = null;
  }
  document.documentElement.classList.remove('cb-fullscreen-toggling');
}
