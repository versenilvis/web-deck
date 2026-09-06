import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { getSettings, getDomainConfig } from '../lib/storage';
import { resolveDomain, getBuiltinCss } from '../lib/sites';
import { setupYtChatResizer, removeYtChatResizer } from '../lib/yt-chat-resizer';
import { setupYtOptimizer, removeYtOptimizer } from '../lib/yt-optimizer';
import resizerCss from '../lib/resizer.css?raw';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    const domain = resolveDomain(window.location.hostname);

    // apply or remove stylesheets and scripts
    const updatePageAssets = async (force = false) => {
      const settings = await getSettings();

      if (!settings.globalEnabled) {
        removeElement('cb-site-style');
        removeElement('cb-custom-style');
        removeElement('cb-resizer-style');
        removeYtChatResizer();
        removeYtOptimizer();
        return;
      }

      const siteConfig = getDomainConfig(settings, domain);

      // handle site css with user edit precedence and module assembly
      const builtin = getBuiltinCss(domain, siteConfig.modules, settings.syncedModules);
      const activeCss = siteConfig.customCss && siteConfig.customCss.trim()
        ? siteConfig.customCss
        : builtin;
      if (activeCss && siteConfig.enabled) {
        injectStyle('cb-site-style', activeCss, force);
      } else {
        removeElement('cb-site-style');
      }

      // handle user custom js
      if (siteConfig.customJs && siteConfig.customJs.trim()) {
        injectScript('cb-custom-script', siteConfig.customJs);
      }

      // handle youtube optimizer and resizer setup
      if (domain === 'youtube.com') {
        if (siteConfig.enabled) {
          setupYtOptimizer();
        } else {
          removeYtOptimizer();
        }

        if (settings.ytChat.enabled) {
          injectStyle('cb-resizer-style', resizerCss, force);
          setupYtChatResizer();
        } else {
          removeElement('cb-resizer-style');
          removeYtChatResizer();
        }
      }
    };

    // inject or replace style tag in document
    const injectStyle = (id: string, cssText: string, force = false) => {
      let tag = document.getElementById(id) as HTMLStyleElement | null;
      const targetParent = document.head || document.documentElement;
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
        if (targetParent) targetParent.appendChild(tag);
      } else if (document.head && tag.parentElement !== document.head) {
        document.head.appendChild(tag);
      }
      if (tag && (force || tag.textContent !== cssText)) {
        tag.textContent = cssText;
      }
    };

    // inject custom js once per update
    const injectScript = (id: string, codeText: string) => {
      removeElement(id);
      const script = document.createElement('script');
      script.id = id;
      script.textContent = codeText;
      (document.head || document.documentElement).appendChild(script);
    };

    // clean up tag by element id
    const removeElement = (id: string) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    };

    updatePageAssets();

    // ensure styles persist across dom ready and spa navigations
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => updatePageAssets());
    }
    window.addEventListener('load', () => updatePageAssets());
    window.addEventListener('yt-navigate-finish', () => updatePageAssets());
    window.addEventListener('yt-page-data-updated', () => updatePageAssets());
    window.addEventListener('popstate', () => updatePageAssets());
    window.addEventListener('turbo:render', () => updatePageAssets());

    // guard in case page wipes head elements during hydration
    const observeHead = () => {
      if (!document.head) return;
      const headObs = new MutationObserver(() => {
        if (!document.getElementById('cb-site-style')) {
          updatePageAssets();
        }
      });
      headObs.observe(document.head, { childList: true });
    };

    if (document.head) {
      observeHead();
    } else {
      document.addEventListener('DOMContentLoaded', observeHead, { once: true });
    }

    // listen for runtime updates from popup
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.wd_settings || changes.cb_settings)) {
        updatePageAssets(true);
      }
    });

    // listen for direct reload trigger from popup
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'cb_reload_assets') {
        updatePageAssets(true);
      }
    });
  },
});
