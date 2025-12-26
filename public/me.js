// Vue 3 + Element Plus "Me" page
const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');

    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);

    const loading = ref(false);
    const updating = ref(false);

    const selfUserId = ref('');
    const selfUsername = ref('');
    const selfFaceUrl = ref('');

    const lastResult = ref('');
    const lastError = ref('');

    const isLoggedIn = computed(() => !!tokenValue() || !!sessionOk.value);

    const selfDisplayName = computed(() => {
      if (selfUsername.value) return selfUsername.value;
      if (selfUserId.value) return selfUserId.value;
      return '未识别用户';
    });

    const selfInitial = computed(() => {
      const s = selfUsername.value || selfUserId.value || '?';
      return String(s).slice(0, 1).toUpperCase();
    });

    const selfIdHint = computed(() => {
      if (!selfUserId.value) return '';
      return `ID: ${selfUserId.value}`;
    });

    function tokenValue() {
      const t = (token.value || '').trim();
      return t ? t : null;
    }

    function clearBadToken() {
      token.value = null;
      try {
        localStorage.removeItem('token');
      } catch (e) {}
    }

    function authHeaders(extra) {
      const h = Object.assign({}, extra || {});
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options, allowRetry) {
      const opt = Object.assign({ credentials: 'include' }, options || {});
      opt.headers = authHeaders(opt.headers);

      const res = await fetch(url, opt);
      const canRetry = allowRetry !== false;
      if (canRetry && res.status === 401) {
        let txt = '';
        try {
          txt = await res.clone().text();
        } catch (e) {}
        if (/invalid token/i.test(txt)) {
          clearBadToken();
          const opt2 = Object.assign({}, opt);
          const h2 = Object.assign({}, opt2.headers || {});
          delete h2.Authorization;
          delete h2.authorization;
          opt2.headers = h2;
          return fetch(url, opt2);
        }
      }

      return res;
    }

    function decodeJwtPayload(jwt) {
      try {
        const parts = String(jwt || '').split('.');
        if (parts.length !== 3) return null;
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
        const json = atob(padded);
        return JSON.parse(json);
      } catch (e) {
        return null;
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
        sessionOk.value = res.ok;
        return res.ok;
      } catch (e) {
        sessionOk.value = false;
        return false;
      }
    }

    async function tryLoadSelfFromMe() {
      try {
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if (!res.ok) return false;
        const me = await res.json().catch(() => null);
        if (!me || typeof me !== 'object') return false;

        const id = me.id || me.userId || me.uid;
        if (id !== undefined && id !== null) selfUserId.value = String(id);
        selfUsername.value = me.username || me.displayName || selfUsername.value;

        const face = me.faceUrl || me.face_url || me.face;
        if (face) selfFaceUrl.value = String(face);

        return true;
      } catch (e) {
        return false;
      }
    }

    async function tryLoadSelfFromUsersList() {
      const t = tokenValue();
      if (!t) return false;
      const payload = decodeJwtPayload(t);
      const meId = payload && (payload.userId || payload.uid || payload.id || payload.sub);
      if (!meId) return false;

      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return false;
        const list = await res.json().catch(() => null);
        if (!Array.isArray(list)) return false;
        const u = list.find((x) => x && String(x.id) === String(meId));
        if (!u) return false;

        selfUserId.value = String(u.id);
        selfUsername.value = u.username || u.displayName || selfUsername.value;
        const face = u.faceUrl || u.face_url || u.face;
        if (face) selfFaceUrl.value = String(face);
        return true;
      } catch (e) {
        return false;
      }
    }

    async function reloadSelf() {
      loading.value = true;
      lastError.value = '';
      try {
        await checkSession();
        const ok = (await tryLoadSelfFromMe()) || (await tryLoadSelfFromUsersList());
        if (!ok) {
          // best-effort only; keep page usable
        }
      } finally {
        loading.value = false;
      }
    }

    async function updateFace() {
      updating.value = true;
      lastResult.value = '';
      lastError.value = '';
      try {
        const res = await safeFetch(`${apiBase.value}/users/me/face`, { method: 'POST' });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object') {
          const url = data.url || data.faceUrl || data.face_url || '';
          if (url) selfFaceUrl.value = String(url);
          lastResult.value = url ? String(url) : JSON.stringify(data);
        } else {
          lastResult.value = 'ok';
        }
        ElementPlus.ElMessage.success('已触发更新');
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        lastError.value = msg;
        ElementPlus.ElMessage.error('更新失败');
      } finally {
        updating.value = false;
      }
    }

    function onNav(key) {
      if (key === 'chat') window.location.href = '/chat.html';
      else if (key === 'players') window.location.href = '/players.html';
      else if (key === 'me') window.location.href = '/me.html';
    }

    function gotoLogin() {
      window.location.href = '/';
    }

    async function logout() {
      token.value = null;
      try {
        localStorage.removeItem('token');
      } catch (e) {}
      sessionOk.value = false;
      try {
        const base = apiAuthBase.value || apiBase.value;
        fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
      } catch (e) {}
      window.location.href = '/';
    }

    onMounted(async () => {
      await fetchConfig();
      await reloadSelf();
    });

    return {
      // state
      loading,
      updating,
      isLoggedIn,
      selfUserId,
      selfUsername,
      selfFaceUrl,
      selfDisplayName,
      selfInitial,
      selfIdHint,
      lastResult,
      lastError,

      // actions
      onNav,
      gotoLogin,
      logout,
      reloadSelf,
      updateFace,
    };
  },
})
  .use(ElementPlus)
  .mount('#app');
