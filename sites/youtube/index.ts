import layout from './layout.css?raw';
import guide from './guide.css?raw';
import header from './header.css?raw';
import feed from './feed.css?raw';
import theater from './theater.css?raw';
import watch from './watch.css?raw';
import search from './search.css?raw';
import player from './player.css?raw';
import optimize from './optimize.css?raw';
import liveChat from './live-chat.css?raw';

export const youtubeModules = {
  layout,
  guide,
  header,
  feed,
  theater,
  watch,
  search,
  player,
  optimize,
};

export const youtubeCss = [
  layout,
  guide,
  header,
  feed,
  theater,
  watch,
  search,
  player,
  optimize,
].join('\n\n');

export const youtubeLiveChatCss = liveChat;
