(function () {
  const KEY = 'minechat_theme';

  function normalizeTheme(v) {
    const t = String(v || '').toLowerCase().trim();
    return t === 'dark' ? 'dark' : 'light';
  }

  function getTheme() {
    try {
      return normalizeTheme(localStorage.getItem(KEY) || 'light');
    } catch (e) {
      return 'light';
    }
  }

  function applyTheme(theme) {
    const t = normalizeTheme(theme);
    const root = document.documentElement;
    if (t === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      root.dataset.theme = t;
    } catch (e) {}
    return t;
  }

  function setTheme(theme) {
    const t = applyTheme(theme);
    try {
      localStorage.setItem(KEY, t);
    } catch (e) {}
    return t;
  }

  function initTheme() {
    applyTheme(getTheme());
  }

  initTheme();

  window.MinechatTheme = {
    KEY,
    get: getTheme,
    set: setTheme,
    apply: applyTheme,
    init: initTheme,
  };
})();
