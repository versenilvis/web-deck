import { getSettings, saveSettings } from './storage';

let isInteracting = false;
let interactionType: 'drag' | 'resize' | null = null;
let currentHandle: string | null = null;
let startX = 0;
let startY = 0;
let startLeft = 0;
let startTop = 0;
let startW = 0;
let startH = 0;
let currentW = 400;
let currentH = 600;
let currentScale = 1;
let startScale = 1;
let currentTop: number | null = null;
let currentLeft: number | null = null;
let chatElement: HTMLElement | null = null;
let iframeElement: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let attachRaf: number | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let currentTarget: HTMLElement | null = null;

// apply position and dimensions directly to chat element and css variables
function applyPositionAndSize(
  el: HTMLElement,
  width: number,
  height: number | string,
  top?: number | null,
  left?: number | null,
  scale?: number,
) {
  const heightVal = typeof height === 'number' ? `${height}px` : height;
  el.style.setProperty('width', `${width}px`, 'important');
  el.style.setProperty('height', heightVal, 'important');
  el.style.setProperty('max-height', '95vh', 'important');
  document.documentElement.style.setProperty('--cb-yt-chat-width', `${width}px`);
  document.documentElement.style.setProperty('--cb-yt-chat-height', heightVal);

  const scaleVal = typeof scale === 'number' ? scale : (currentScale || 1);
  currentScale = scaleVal;
  document.documentElement.style.setProperty('--cb-yt-chat-scale', String(scaleVal));

  const iframe = (el.tagName === 'IFRAME' ? el : el.querySelector('iframe')) as HTMLIFrameElement | null
    || document.querySelector<HTMLIFrameElement>('iframe#chatframe');
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'cb_chat_scale', scale: scaleVal }, '*');
  }

  if (typeof top === 'number' && typeof left === 'number') {
    el.style.setProperty('position', 'absolute', 'important');
    el.style.setProperty('top', `${top}px`, 'important');
    el.style.setProperty('left', `${left}px`, 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
    el.style.setProperty('transform', 'none', 'important');
    document.documentElement.style.setProperty('--cb-yt-chat-top', `${top}px`);
    document.documentElement.style.setProperty('--cb-yt-chat-left', `${left}px`);
    document.documentElement.style.setProperty('--cb-yt-chat-right', 'auto');
    document.documentElement.style.setProperty('--cb-yt-chat-transform', 'none');
  } else {
    // default position attached to player right edge
    el.style.removeProperty('left');
    el.style.removeProperty('bottom');
    el.style.setProperty('position', 'absolute', 'important');
    el.style.setProperty('top', '50vh', 'important');
    el.style.setProperty('right', '1rem', 'important');
    el.style.setProperty('transform', 'translateY(-50%)', 'important');
    document.documentElement.style.setProperty('--cb-yt-chat-top', '50vh');
    document.documentElement.style.setProperty('--cb-yt-chat-left', 'auto');
    document.documentElement.style.setProperty('--cb-yt-chat-right', '1rem');
    document.documentElement.style.setProperty('--cb-yt-chat-transform', 'translateY(-50%)');
  }
}

// find chat container across different youtube player layouts
function findChatTarget(): HTMLElement | null {
  const frame = document.querySelector<HTMLElement>('ytd-live-chat-frame, iframe#chatframe');
  if (frame) {
    const chatParent = frame.closest<HTMLElement>('#chat');
    if (chatParent) return chatParent;
    const frameParent = frame.closest<HTMLElement>('ytd-live-chat-frame');
    if (frameParent) return frameParent;
    return frame;
  }
  return document.querySelector<HTMLElement>('#chat');
}

// create and attach resize and drag handles to target
function injectHandles(target: HTMLElement) {
  if (target.id === 'chat') {
    document.querySelectorAll('ytd-live-chat-frame > .cb-resizer-container').forEach((el) => el.remove());
    const innerFrame = target.querySelector<HTMLElement>('ytd-live-chat-frame');
    if (innerFrame) delete innerFrame.dataset.cbResizer;
  }

  const existingContainer = target.querySelector<HTMLElement>(':scope > .cb-resizer-container');
  if (target.dataset.cbResizer === 'true' && existingContainer) {
    return;
  }
  target.dataset.cbResizer = 'true';

  if (existingContainer) {
    existingContainer.remove();
  }

  target.style.position = 'absolute';
  target.style.overflow = 'visible';

  const container = document.createElement('div');
  container.className = 'cb-resizer-container';

  const onHandleEnter = () => target.classList.add('cb-hover');
  const onHandleLeave = () => {
    if (!isInteracting) target.classList.remove('cb-hover');
  };

  // top drag handle to move chat window freely
  const dragHandle = document.createElement('div');
  dragHandle.className = 'cb-handle cb-drag-handle';
  dragHandle.title = 'Drag to move chat (Double-click to reset position)';
  const pill = document.createElement('div');
  pill.className = 'cb-drag-bar-pill';
  dragHandle.appendChild(pill);
  dragHandle.addEventListener('pointerdown', (e) => onPointerDown(e, 'drag', 'move', target));
  dragHandle.addEventListener('dblclick', (e) => onResetDefault(e, target));
  dragHandle.addEventListener('mouseenter', onHandleEnter);
  dragHandle.addEventListener('mouseleave', onHandleLeave);
  container.appendChild(dragHandle);

  // 8-direction resize handles
  const handles = [
    { type: 'w', title: 'Drag edge to resize width' },
    { type: 'e', title: 'Drag edge to resize width' },
    { type: 'n', title: 'Drag edge to resize height' },
    { type: 's', title: 'Drag edge to resize height' },
    { type: 'nw', title: 'Drag corner to scale live chat (Double-click to reset)' },
    { type: 'ne', title: 'Drag corner to scale live chat (Double-click to reset)' },
    { type: 'sw', title: 'Drag corner to scale live chat (Double-click to reset)' },
    { type: 'se', title: 'Drag corner to scale live chat (Double-click to reset)' },
  ];

  handles.forEach((item) => {
    const handle = document.createElement('div');
    handle.className = `cb-handle cb-handle-${item.type}`;
    handle.title = item.title;
    handle.addEventListener('pointerdown', (e) => onPointerDown(e, 'resize', item.type, target));
    handle.addEventListener('dblclick', (e) => onResetDefault(e, target));
    handle.addEventListener('mouseenter', onHandleEnter);
    handle.addEventListener('mouseleave', onHandleLeave);
    container.appendChild(handle);
  });

  target.appendChild(container);
}

// reset size, position and scale to defaults on double click
async function onResetDefault(e: MouseEvent, target: HTMLElement) {
  e.preventDefault();
  e.stopPropagation();
  const defW = 400;
  const defH = '68vh';
  const defScale = 1;
  currentScale = defScale;
  applyPositionAndSize(target, defW, defH, null, null, defScale);

  const settings = await getSettings();
  settings.ytChat.width = defW;
  settings.ytChat.height = defH;
  settings.ytChat.top = null;
  settings.ytChat.left = null;
  settings.ytChat.scale = defScale;
  await saveSettings(settings);
}

// begin drag or resize operation
function onPointerDown(
  e: PointerEvent,
  actionType: 'drag' | 'resize',
  handleType: string,
  target: HTMLElement,
) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const handle = e.currentTarget as HTMLElement | null;
  if (handle?.setPointerCapture) {
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {}
  }

  isInteracting = true;
  interactionType = actionType;
  currentHandle = handleType;
  chatElement = target;
  startX = e.clientX;
  startY = e.clientY;

  const rect = target.getBoundingClientRect();
  const watchContainer = document.querySelector<HTMLElement>('ytd-watch-flexy, ytd-watch-grid')
    || (target.offsetParent as HTMLElement | null)
    || document.documentElement;
  const parentRect = watchContainer.getBoundingClientRect();

  startLeft = Math.round(rect.left - parentRect.left);
  startTop = Math.round(rect.top - parentRect.top);
  startW = Math.round(rect.width);
  startH = Math.round(rect.height);
  startScale = currentScale || 1;

  currentW = startW;
  currentH = startH;
  currentTop = startTop;
  currentLeft = startLeft;

  iframeElement = target.querySelector('iframe');
  if (iframeElement) {
    iframeElement.style.pointerEvents = 'none';
  }

  target.classList.add('cb-hover');
  if (actionType === 'drag') {
    document.body.classList.add('cb-moving-active');
  } else {
    document.body.classList.add('cb-resizing-active');
  }

  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp, { once: true });
  window.addEventListener('pointercancel', onPointerUp, { once: true });
}

// process movement during drag or resize
function onPointerMove(e: PointerEvent) {
  if (!isInteracting || !chatElement) return;
  e.preventDefault();

  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  if (interactionType === 'drag') {
    let nextLeft = startLeft + dx;
    let nextTop = startTop + dy;

    // keep within reasonable boundaries
    nextLeft = Math.max(0, Math.min(window.innerWidth - 60, nextLeft));
    nextTop = Math.max(0, Math.min(document.documentElement.scrollHeight - 60, nextTop));

    currentLeft = Math.round(nextLeft);
    currentTop = Math.round(nextTop);

    applyPositionAndSize(chatElement, currentW, `${currentH}px`, currentTop, currentLeft, currentScale);
    return;
  }

  if (interactionType === 'resize' && currentHandle) {
    const isCorner = ['nw', 'ne', 'sw', 'se'].includes(currentHandle);

    if (isCorner) {
      // diagonal corner drag scales the entire component proportionally (font, icons, dimensions)
      let ratio = 1;
      if (currentHandle === 'se') {
        ratio = ((startW + dx) / startW + (startH + dy) / startH) / 2;
      } else if (currentHandle === 'sw') {
        ratio = ((startW - dx) / startW + (startH + dy) / startH) / 2;
      } else if (currentHandle === 'ne') {
        ratio = ((startW + dx) / startW + (startH - dy) / startH) / 2;
      } else if (currentHandle === 'nw') {
        ratio = ((startW - dx) / startW + (startH - dy) / startH) / 2;
      }

      const nextScale = Math.max(0.4, Math.min(2.0, startScale * ratio));
      const newW = Math.max(200, Math.min(window.innerWidth * 0.9, Math.round(startW * (nextScale / startScale))));
      const newH = Math.max(140, Math.min(window.innerHeight * 0.95, Math.round(startH * (nextScale / startScale))));

      let newLeft = startLeft;
      let newTop = startTop;

      if (currentHandle.includes('w')) {
        newLeft = startLeft + (startW - newW);
      }
      if (currentHandle.includes('n')) {
        newTop = startTop + (startH - newH);
      }

      currentW = newW;
      currentH = newH;
      currentLeft = Math.round(newLeft);
      currentTop = Math.round(newTop);
      currentScale = Math.round(nextScale * 100) / 100;

      applyPositionAndSize(chatElement, currentW, `${currentH}px`, currentTop, currentLeft, currentScale);
      return;
    }

    // standard edge drag (horizontal / vertical) adjusts box size only
    let newW = startW;
    let newH = startH;
    let newLeft = startLeft;
    let newTop = startTop;

    // horizontal resizing
    if (currentHandle.includes('w')) {
      newW = Math.max(260, Math.min(window.innerWidth * 0.9, startW - dx));
      newLeft = startLeft + (startW - newW);
    } else if (currentHandle.includes('e')) {
      newW = Math.max(260, Math.min(window.innerWidth * 0.9, startW + dx));
    }

    // vertical resizing
    if (currentHandle.includes('n')) {
      newH = Math.max(160, Math.min(window.innerHeight * 0.95, startH - dy));
      newTop = startTop + (startH - newH);
    } else if (currentHandle.includes('s')) {
      newH = Math.max(160, Math.min(window.innerHeight * 0.95, startH + dy));
    }

    currentW = Math.round(newW);
    currentH = Math.round(newH);
    currentLeft = Math.round(newLeft);
    currentTop = Math.round(newTop);

    applyPositionAndSize(chatElement, currentW, `${currentH}px`, currentTop, currentLeft, currentScale);
  }
}

// finish interaction and persist state
async function onPointerUp(e: PointerEvent) {
  if (!isInteracting || !chatElement) return;

  const handle = e.currentTarget as HTMLElement | null;
  if (handle?.releasePointerCapture) {
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {}
  }

  isInteracting = false;
  interactionType = null;
  currentHandle = null;

  if (iframeElement) {
    iframeElement.style.pointerEvents = '';
    iframeElement = null;
  }
  document.body.classList.remove('cb-resizing-active');
  document.body.classList.remove('cb-moving-active');
  chatElement.classList.remove('cb-hover');

  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);

  const rect = chatElement.getBoundingClientRect();
  const width = Math.round(rect.width);
  const heightPx = Math.round(rect.height);

  const settings = await getSettings();
  settings.ytChat.width = width;
  settings.ytChat.height = `${heightPx}px`;
  settings.ytChat.top = currentTop;
  settings.ytChat.left = currentLeft;
  settings.ytChat.scale = currentScale;
  await saveSettings(settings);
}

// locate chat element and attach handles
export async function setupYtChatResizer() {
  const settings = await getSettings();
  if (!settings.globalEnabled || !settings.ytChat.enabled) {
    removeYtChatResizer();
    return;
  }

  const findAndAttach = (): boolean => {
    const chat = findChatTarget();
    if (!chat) return false;

    // already attached to connected element with resizer container present
    if (
      currentTarget === chat &&
      chat.isConnected &&
      chat.dataset.cbResizer === 'true' &&
      chat.querySelector(':scope > .cb-resizer-container')
    ) {
      currentScale = settings.ytChat.scale || 1;
      applyPositionAndSize(
        chat,
        settings.ytChat.width,
        settings.ytChat.height || '68vh',
        settings.ytChat.top,
        settings.ytChat.left,
        currentScale,
      );
      return true;
    }

    currentTarget = chat;
    currentScale = settings.ytChat.scale || 1;
    applyPositionAndSize(
      chat,
      settings.ytChat.width,
      settings.ytChat.height || '68vh',
      settings.ytChat.top,
      settings.ytChat.left,
      currentScale,
    );
    injectHandles(chat);

    const iframe = (chat.tagName === 'IFRAME' ? chat : chat.querySelector('iframe')) as HTMLIFrameElement | null
      || document.querySelector<HTMLIFrameElement>('iframe#chatframe');
    if (iframe) {
      iframe.setAttribute('allowtransparency', 'true');
      iframe.style.setProperty('background', 'transparent', 'important');
      iframe.style.setProperty('background-color', 'transparent', 'important');
      iframe.addEventListener('load', () => {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'cb_chat_scale', scale: currentScale }, '*');
        }
      });
    }
    chat.style.setProperty('background', 'transparent', 'important');
    chat.style.setProperty('background-color', 'transparent', 'important');
    return true;
  };

  const scheduleAttach = () => {
    if (attachRaf !== null) return;
    attachRaf = requestAnimationFrame(() => {
      attachRaf = null;
      const attached = findAndAttach();
      if (attached && observer) {
        observer.disconnect();
        observer = null;
      }
    });
  };

  const initObserver = () => {
    if (observer) return;
    if (
      currentTarget &&
      currentTarget.isConnected &&
      currentTarget.dataset.cbResizer === 'true' &&
      currentTarget.querySelector(':scope > .cb-resizer-container')
    ) {
      return;
    }
    const root = document.querySelector('ytd-watch-flexy, ytd-watch-grid, #page-manager') || document.body || document.documentElement;
    if (!root) return;
    observer = new MutationObserver(() => {
      scheduleAttach();
    });
    observer.observe(root, { childList: true, subtree: true });
  };

  // initial check
  const attached = findAndAttach();
  if (!attached) {
    initObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const isAttached = findAndAttach();
      if (!isAttached) initObserver();
    }, { once: true });
  }

  window.addEventListener('load', () => {
    const isAttached = findAndAttach();
    if (!isAttached) initObserver();
  }, { once: true });

  const onNav = () => {
    currentTarget = null;
    const isAttached = findAndAttach();
    if (!isAttached) {
      initObserver();
    }
  };

  window.addEventListener('yt-navigate-finish', onNav);
  window.addEventListener('yt-page-data-updated', onNav);

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  let pollCount = 0;
  pollTimer = setInterval(() => {
    pollCount++;
    const isAttached = findAndAttach();
    if (isAttached || pollCount >= 20) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  }, 500);
}

// remove attached handles and observers
export function removeYtChatResizer() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (attachRaf !== null) {
    cancelAnimationFrame(attachRaf);
    attachRaf = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  currentTarget = null;
  const containers = document.querySelectorAll('.cb-resizer-container');
  containers.forEach((el) => el.remove());
  const chat = findChatTarget();
  if (chat) {
    delete chat.dataset.cbResizer;
    chat.classList.remove('cb-hover');
  }
}
