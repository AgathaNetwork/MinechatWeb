// Mobile me page
const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);
    const isLoggedIn = computed(() => !!tokenValue() || !!sessionOk.value);
    const selfUserId = ref('');
    const selfUsername = ref('');
    const selfFaceUrl = ref('');
    const updating = ref(false);
    const lastResult = ref('');
    const lastError = ref('');

    const selfDisplayName = computed(() => selfUsername.value || selfUserId.value || '未登录');
    const selfIdHint = computed(() => selfUserId.value ? `ID: ${selfUserId.value}` : '');
    const selfInitial = computed(() => {
      const name = selfUsername.value || selfUserId.value || '?';
      return name.charAt(0).toUpperCase();
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

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

    function authHeaders() {
      const h = {};
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({}, options || {});
      opt.headers = Object.assign({}, opt.headers || {}, authHeaders());
      // 只在没有 token 时才使用 credentials（依赖 cookie）
      if (!tokenValue()) {
        opt.credentials = 'include';
      }

      const res = await fetch(url, opt);
      if (res.status === 401) {
        let txt = '';
        try {
          txt = await res.clone().text();
        } catch (e) {}
        if (/invalid token/i.test(txt)) {
          clearBadToken();
        }
      }
      return res;
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

    async function loadSelf() {
      try {
        await checkSession();

        // Prefer /users/me (desktop-compatible)
        let res = await safeFetch(`${apiBase.value}/users/me`);
        if (!res.ok && res.status === 404) {
          // Fallback for older backend
          res = await safeFetch(`${apiBase.value}/me`);
        }
        if (!res.ok) return;
        const me = await res.json().catch(() => null);
        if (!me || typeof me !== 'object') return;

        const id = me.id || me.userId || me.uid;
        selfUserId.value = id !== undefined && id !== null ? String(id) : '';
        selfUsername.value = me.username || me.displayName || me.name || '';
        const face = me.faceUrl || me.face_url || me.face;
        if (face) selfFaceUrl.value = String(face);

        // If backend doesn't return username, try resolve from token + /users list
        if (!selfUsername.value) {
          const t = tokenValue();
          const payload = t ? decodeJwtPayload(t) : null;
          const meId = payload && (payload.userId || payload.uid || payload.id || payload.sub);
          if (meId) {
            const listRes = await safeFetch(`${apiBase.value}/users`);
            if (listRes.ok) {
              const list = await listRes.json().catch(() => null);
              if (Array.isArray(list)) {
                const u = list.find(x => x && String(x.id) === String(meId));
                if (u) {
                  selfUsername.value = u.username || u.displayName || selfUsername.value;
                  const f = u.faceUrl || u.face_url || u.face;
                  if (f && !selfFaceUrl.value) selfFaceUrl.value = String(f);
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    async function updateFace() {
      lastResult.value = '';
      lastError.value = '';
      updating.value = true;

      try {
        // Desktop-compatible endpoint
        let res = await safeFetch(`${apiBase.value}/users/me/face`, { method: 'POST' });
        if (!res.ok && res.status === 404) {
          // Fallback for older backend
          res = await safeFetch(`${apiBase.value}/me/update-face`, { method: 'POST' });
        }

        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || '更新失败');
        }

        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object') {
          const url = data.url || data.faceUrl || data.face_url || '';
          if (url) selfFaceUrl.value = String(url);
        }
        lastResult.value = '头像更新成功';
        
        await loadSelf();
        ElementPlus.ElMessage.success('头像更新成功');
      } catch (e) {
        lastError.value = e.message || '更新失败';
        ElementPlus.ElMessage.error(lastError.value);
      } finally {
        updating.value = false;
      }
    }

    async function logout() {
      try {
        await safeFetch(`${apiBase.value}/auth/logout`, { method: 'POST' });
      } catch (e) {}
      
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('faceUrl');
      } catch (e) {}
      
      window.location.href = '/';
    }

    function goEmojiManage() {
      window.location.href = '/m/emojis.html';
    }

    onMounted(async () => {
      await fetchConfig();
      await loadSelf();
    });

    return {
      isLoggedIn,
      selfDisplayName,
      selfIdHint,
      selfInitial,
      selfFaceUrl,
      updating,
      lastResult,
      lastError,
      updateFace,
      logout,
      goEmojiManage,
    };
  },
}).use(ElementPlus).mount('#app');
