import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { getSettings, type Settings } from '../lib/storage';
import { syncWithGitHub } from '../lib/github-sync';

const ALARM_NAME = 'cb_github_autoupdate';

export default defineBackground(() => {
  // schedule or update periodic github check alarm
  const updateAlarm = async (settings: Settings) => {
    const { github } = settings;
    const isEnabled = settings.globalEnabled && github.autoUpdate !== false && Boolean(github.repo.trim());
    const interval = Math.max(0.5, github.updateIntervalMinutes || 1);

    if (isEnabled) {
      browser.alarms.create(ALARM_NAME, {
        periodInMinutes: interval,
      });
    } else {
      browser.alarms.clear(ALARM_NAME);
    }
  };

  // run background sync check
  const runBackgroundSync = async (force = false) => {
    const settings = await getSettings();
    if (!settings.globalEnabled || !settings.github.repo.trim()) return;
    if (!force && settings.github.autoUpdate === false) return;
    await syncWithGitHub(force);
  };

  // alarm listener for periodic polling
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      runBackgroundSync(false);
    }
  });

  // initial setup on browser start or extension install
  getSettings().then((settings) => {
    updateAlarm(settings);
    // delay initial check slightly after boot
    setTimeout(() => {
      runBackgroundSync(false);
    }, 4000);
  });

  // update alarm if settings change
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      const change = changes.wd_settings || changes.cb_settings;
      if (change?.newValue) {
        updateAlarm(change.newValue as Settings);
      }
    }
  });

  // handle explicit sync trigger message
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'cb_trigger_sync') {
      syncWithGitHub(Boolean(msg.force)).then((res) => {
        sendResponse(res);
      });
      return true;
    }
  });
});
