import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { getSettings } from '../lib/storage';
import { liveChatFrameCss } from '../lib/sites';

export default defineContentScript({
  matches: [
    '*://*.youtube.com/live_chat*',
    '*://*.youtube.com/live_chat_replay*',
  ],
  allFrames: true,
  runAt: 'document_start',
  main() {
    const updateChatFrameStyle = async (force = false) => {
      const settings = await getSettings();
      const styleId = 'cb-youtube-live-chat-style';
      let tag = document.getElementById(styleId) as HTMLStyleElement | null;

      if (settings.globalEnabled && settings.sites['youtube.com']?.enabled !== false) {
        const targetParent = document.head || document.documentElement;
        if (!tag) {
          tag = document.createElement('style');
          tag.id = styleId;
          if (targetParent) targetParent.appendChild(tag);
        } else if (document.head && tag.parentElement !== document.head) {
          document.head.appendChild(tag);
        }
        const effectiveCss = settings.syncedModules?.['youtube.com']?.['live-chat'] || liveChatFrameCss;
        if (tag && (force || tag.textContent !== effectiveCss)) {
          tag.textContent = effectiveCss;
        }

        const scale = settings.ytChat?.scale ?? 1;
        document.documentElement.style.setProperty('--cb-yt-chat-scale', String(scale));
        document.documentElement.style.zoom = String(scale);

        const hideHeader = Boolean(settings.ytChat?.hideHeader);
        const hideInput = Boolean(settings.ytChat?.hideInput);
        document.documentElement.classList.toggle('cb-hide-chat-header', hideHeader);
        document.documentElement.classList.toggle('cb-hide-chat-input', hideInput);
      } else if (tag) {
        tag.remove();
        document.documentElement.style.removeProperty('--cb-yt-chat-scale');
        document.documentElement.style.zoom = '';
        document.documentElement.classList.remove('cb-hide-chat-header');
        document.documentElement.classList.remove('cb-hide-chat-input');
      }
    };

    // listen for real-time scale updates from resizer
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'cb_chat_scale' && typeof e.data.scale === 'number') {
        document.documentElement.style.setProperty('--cb-yt-chat-scale', String(e.data.scale));
        document.documentElement.style.zoom = String(e.data.scale);
      }
    });

    updateChatFrameStyle();

    // ensure style attached when dom is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => updateChatFrameStyle());
    }
    window.addEventListener('load', () => updateChatFrameStyle());

    // guard in case youtube iframe rewrites head
    const observeChatHead = () => {
      if (!document.head) return;
      const obs = new MutationObserver(() => {
        if (!document.getElementById('cb-youtube-live-chat-style')) {
          updateChatFrameStyle(true);
        }
      });
      obs.observe(document.head, { childList: true });
    };

    if (document.head) {
      observeChatHead();
    } else {
      document.addEventListener('DOMContentLoaded', observeChatHead, { once: true });
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.wd_settings || changes.cb_settings)) {
        updateChatFrameStyle(true);
      }
    });

    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'cb_reload_assets') {
        updateChatFrameStyle(true);
      }
    });
  },
});
