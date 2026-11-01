'use strict';

// Only these destinations may be opened by the renderer, never arbitrary URLs.
const links = Object.freeze({
  github: 'https://github.com/rakanki911/DLSS5-Swapper',
  releases: 'https://github.com/rakanki911/DLSS5-Swapper/releases/latest',
  coffee: 'https://buymeacoffee.com/rakanki911',
  zhGithub: 'https://github.com/hezhixin15/DLSS5-Swapper-Chinese',
  zhReleases: 'https://github.com/hezhixin15/DLSS5-Swapper-Chinese/releases/latest',
  zhGitee: 'https://gitee.com/hezhixin15/DLSS5-Swapper-Chinese',
  pan123: 'https://1818284482.share.123pan.cn/123pan/hiJ3jv-xuTw'
});
function projectUrl(key) {
  return typeof key === 'string' && Object.hasOwn(links, key) ? links[key] : null;
}
module.exports = { links, projectUrl };
