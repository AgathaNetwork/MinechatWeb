// Vue 3 + Element Plus login page
const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const tokenInput = ref(localStorage.getItem('token') || '');
    const checking = ref(false);
    const hasSession = ref(false);

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

    function gotoChat() {
      window.location.href = '/chat.html';
    }

    async function logoutSession() {
      try {
        await fetch(`${apiBase.value}/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch (e) {}
      hasSession.value = false;
    }

    function openLoginPopup() {
      const base = apiAuthBase.value || apiBase.value;
      const popup = window.open(`${base}/auth/microsoft`, 'oauth', 'width=600,height=700');

      // Don’t try to read popup DOM (cross-origin). Instead, poll session cookie.
      let tries = 0;
      const timer = setInterval(async () => {
        tries++;
        const ok = await checkSession();
        if (ok) {
          clearInterval(timer);
          try {
            if (popup && !popup.closed) popup.close();
          } catch (e) {}
          gotoChat();
          return;
        }
        // stop after ~2 minutes
        if (tries > 150) {
          clearInterval(timer);
        }
      }, 800);
    }

    function applyToken() {
      const t = tokenInput.value.trim();
      if (!t) return ElementPlus.ElMessage.warning('请输入 token');
      localStorage.setItem('token', t);
      gotoChat();
    }

    onMounted(async () => {
      checking.value = true;
      await fetchConfig();
      hasSession.value = await checkSession();
      checking.value = false;
    });

    return { tokenInput, checking, hasSession, openLoginPopup, applyToken, gotoChat, logoutSession };
  },
}).use(ElementPlus).mount('#app');
