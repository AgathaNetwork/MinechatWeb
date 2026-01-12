// Vue 3 + Element Plus login page
const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const tokenInput = ref(localStorage.getItem('token') || '');
    const checking = ref(false);
    const hasSession = ref(false);
    const loggingIn = ref(false);

    const authOk = ref(null); // null | true | false
    const authUserId = ref('');
    const authUsername = ref('');
    const authFaceUrl = ref('');
    const authChatsCount = ref(null);
    const authError = ref('');
    const authDetail = ref('');

    function base64UrlToJson(str) {
      try {
        const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
        const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
        const json = atob(padded);
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }

    function clearAuthState() {
      authOk.value = null;
      authUserId.value = '';
      authUsername.value = '';
      authFaceUrl.value = '';
      authChatsCount.value = null;
      authError.value = '';
      authDetail.value = '';
    }

    function processAuthRedirectUrl(href, opts) {
      try {
        const url = new URL(href || window.location.href);
        const sp = url.searchParams;
        if (!sp.has('ok')) return false;

        clearAuthState();

        const ok = sp.get('ok') === '1';
        authOk.value = ok;

        if (ok) {
          const token = sp.get('token') || '';
          const userId = sp.get('userId') || '';
          const username = sp.get('username') || '';
          const faceUrl = sp.get('faceUrl') || '';
          const chats = sp.get('chats') || '';

          if (token) {
            try { localStorage.setItem('token', token); } catch (e) {}
            tokenInput.value = token;
            // Try to notify outer container (electron / app shell / parent) about the token
            try {
              console.log('[login] obtained token, calling sendTokenToHost', token && token.slice ? token.slice(0,8)+'...' : token);
              sendTokenToHost(token);
            } catch (e) { console.warn('[login] sendTokenToHost failed', e); }
          }
          if (username) {
            try { localStorage.setItem('username', username); } catch (e) {}
          }
          if (faceUrl) {
            try { localStorage.setItem('faceUrl', faceUrl); } catch (e) {}
          }

          authUserId.value = userId;
          authUsername.value = username;
          authFaceUrl.value = faceUrl;

          if (chats) {
            const parsed = base64UrlToJson(chats);
            if (Array.isArray(parsed)) authChatsCount.value = parsed.length;
            try { sessionStorage.setItem('chats_cache', JSON.stringify(parsed)); } catch (e) {}
          }
        } else {
          authError.value = sp.get('error') || '登录失败';
          authDetail.value = sp.get('detail') || '';
        }

        // Clear query params (keep page clean). Only do it for current window.
        const fromPopup = opts && opts.fromPopup;
        if (!fromPopup) {
          try {
            const clean = url.origin + url.pathname + url.hash;
            window.history.replaceState({}, document.title, clean);
          } catch (e) {}
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
    }

    async function checkSession() {
      try {
        const res = await fetch(`${apiBase.value}/chats`, { credentials: 'include' });
        return res.ok;
      } catch (e) {
        return false;
      }
    }

    function isMobileDevice() {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    }

    function gotoChat() {
      if (isMobileDevice()) {
        window.location.href = '/m/chats.html';
      } else {
        window.location.href = '/chat.html';
      }
    }

    async function logoutSession() {
      try {
        await fetch(`${apiBase.value}/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch (e) {}
      hasSession.value = false;
    }

    function openLoginPopup() {
      if (loggingIn.value) return;
      loggingIn.value = true;
      // No popup: redirect current page to start OAuth.
      // Prefer same-origin proxy (/api) to avoid CORS issues.
      const base = apiBase.value || apiAuthBase.value;
      try { clearAuthState(); } catch (e) {}
      window.location.href = `${base}/auth/microsoft`;
    }

    function applyToken() {
      const t = tokenInput.value.trim();
      if (!t) return ElementPlus.ElMessage.warning('请输入 token');
      localStorage.setItem('token', t);
      try { console.log('[login] applyToken calling sendTokenToHost', t && t.slice ? t.slice(0,8)+'...' : t); sendTokenToHost(t); } catch (e) { console.warn('[login] sendTokenToHost failed', e); }
      gotoChat();
    }

    function sendTokenToHost(token) {
      const msg = { type: 'minechat-token', token: String(token || '') };
      // Attempt various common host-bridge mechanisms, logging each attempt
      try {
        if (window.postMessage) {
          try {
            console.log('[login] sendTokenToHost: calling window.postMessage', msg);
            window.postMessage(msg, '*');
          } catch (e) { console.warn('[login] window.postMessage failed', e); }
        } else {
          console.log('[login] sendTokenToHost: window.postMessage not available');
        }
      } catch (e) { console.warn('[login] sendTokenToHost postMessage error', e); }

      try {
        if (window.top && window.top !== window && window.top.postMessage) {
          try {
            console.log('[login] sendTokenToHost: calling window.top.postMessage', msg);
            window.top.postMessage(msg, '*');
          } catch (e) { console.warn('[login] window.top.postMessage failed', e); }
        } else {
          console.log('[login] sendTokenToHost: window.top.postMessage not available or same as window');
        }
      } catch (e) { console.warn('[login] sendTokenToHost top.postMessage error', e); }

      try {
        if (window.parent && window.parent !== window && window.parent.postMessage) {
          try {
            console.log('[login] sendTokenToHost: calling window.parent.postMessage', msg);
            window.parent.postMessage(msg, '*');
          } catch (e) { console.warn('[login] window.parent.postMessage failed', e); }
        } else {
          console.log('[login] sendTokenToHost: window.parent.postMessage not available or same as window');
        }
      } catch (e) { console.warn('[login] sendTokenToHost parent.postMessage error', e); }

      try {
        if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
          console.log('[login] sendTokenToHost: posting to chrome.webview.postMessage', msg);
          window.chrome.webview.postMessage(msg);
        } else {
          console.log('[login] sendTokenToHost: chrome.webview.postMessage not available');
        }
      } catch (e) { console.warn('[login] sendTokenToHost chrome.webview error', e); }

      try {
        if (window.external && typeof window.external.invoke === 'function') {
          console.log('[login] sendTokenToHost: calling window.external.invoke', msg);
          window.external.invoke(JSON.stringify(msg));
        } else {
          console.log('[login] sendTokenToHost: window.external.invoke not available');
        }
      } catch (e) { console.warn('[login] sendTokenToHost external.invoke error', e); }
    }

    onMounted(async () => {
      checking.value = true;
      await fetchConfig();

      // If backend redirected to this page with auth params, apply them.
      processAuthRedirectUrl(window.location.href);

      hasSession.value = await checkSession();
      checking.value = false;
    });

    return {
      tokenInput,
      checking,
      loggingIn,
      hasSession,
      openLoginPopup,
      applyToken,
      gotoChat,
      logoutSession,

      authOk,
      authUserId,
      authUsername,
      authFaceUrl,
      authChatsCount,
      authError,
      authDetail,
    };
  },
}).use(ElementPlus).mount('#app');
