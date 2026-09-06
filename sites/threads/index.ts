import layout from './layout.css?raw';
import transparency from './transparency.css?raw';

export const threadsModules = {
  layout,
  transparency,
};

export const threadsCss = [layout, transparency].join('\n\n');
