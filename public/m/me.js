// Mobile me page
const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const isLoggedIn = computed(() => !!token.value);
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

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiBase || '';
    }

    function authHeaders() {
      const h = {};
      const t = token.value;
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({}, options || {});
      opt.headers = authHeaders();
      // 只在没有 token 时才使用 credentials（依赖 cookie）
      if (!token.value) {
        opt.credentials = 'include';
      }
      return fetch(url, opt);
    }

    async function loadSelf() {
      try {
        const res = await safeFetch(`${apiBase.value}/me`);
        if (!res.ok) return;
        const me = await res.json();
        selfUserId.value = me.id || '';
        selfUsername.value = me.username || '';
        const face = me.faceUrl || me.face_url || me.face;
        if (face) selfFaceUrl.value = String(face);
      } catch (e) {}
    }

    async function updateFace() {
      lastResult.value = '';
      lastError.value = '';
      updating.value = true;

      try {
        const res = await safeFetch(`${apiBase.value}/me/update-face`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || '更新失败');
        }

        const data = await res.json();
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
