// Mobile players page
const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const users = ref([]);
    const q = ref('');
    const selfUserId = ref(null);

    const filtered = computed(() => {
      const query = (q.value || '').trim().toLowerCase();
      if (!query) return users.value;
      return users.value.filter(u => {
        const username = (u.username || '').toLowerCase();
        const id = (u.id || '').toLowerCase();
        return username.includes(query) || id.includes(query);
      });
    });

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

    function authHeaders() {
      const h = {};
      const t = token.value;
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({}, options || {});
      opt.headers = Object.assign({}, opt.headers || {}, authHeaders());
      // 只在没有 token 时才使用 credentials（依赖 cookie）
      if (!token.value) {
        opt.credentials = 'include';
      }
      return fetch(url, opt);
    }

    async function loadUsers() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const all = await res.json();
        users.value = all.map(u => ({
          ...u,
          faceUrl: u.faceUrl || u.face_url || u.face || '',
        }));
      } catch (e) {}
    }

    async function resolveSelfProfile() {
      try {
        const res = await safeFetch(`${apiBase.value}/me`);
        if (!res.ok) return;
        const me = await res.json();
        selfUserId.value = me.id;
      } catch (e) {}
    }

    async function openChat(userId) {
      try {
        // Prefer desktop-compatible endpoint
        let res = await safeFetch(`${apiBase.value}/chats/with/${encodeURIComponent(userId)}`, {
          method: 'POST',
        });

        if (!res.ok && (res.status === 404 || res.status === 405)) {
          // Fallback to older/mobile endpoint if backend differs
          res = await safeFetch(`${apiBase.value}/chats/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ members: [userId] }),
          });
        }

        if (!res.ok) throw new Error('创建会话失败');
        const data = await res.json().catch(() => null);
        const chatId =
          (data && (data.chatId || data.id)) ||
          (data && data.chat && (data.chat.id || data.chat.chatId)) ||
          null;
        if (!chatId) throw new Error('no chatId');
        window.location.href = `/m/chat_detail.html?chat=${encodeURIComponent(chatId)}`;
      } catch (e) {
        ElementPlus.ElMessage.error('无法创建会话');
      }
    }

    function onInput() {
      // Auto filter on input change
    }

    onMounted(async () => {
      await fetchConfig();
      await resolveSelfProfile();
      await loadUsers();
    });

    return {
      users,
      filtered,
      q,
      openChat,
      onInput,
    };
  },
}).use(ElementPlus).mount('#app');
