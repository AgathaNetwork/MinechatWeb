// Mobile players page
const { createApp, ref, reactive, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const users = ref([]);
    const q = ref('');
    const selfUserId = ref(null);
    const usersLoading = ref(false);

    const groupMode = ref(false);
    const groupName = ref('');
    const selectedMap = reactive({});
    const createGroupLoading = ref(false);

    const filtered = computed(() => {
      const query = (q.value || '').trim().toLowerCase();
      if (!query) return users.value;
      return users.value.filter(u => {
        const username = (u.username || '').toLowerCase();
        const id = (u.id || '').toLowerCase();
        const mc = (u.mcUuid || '').toLowerCase();
        return username.includes(query) || id.includes(query) || mc.includes(query);
      });
    });

    function extractMinecraftUuid(obj) {
      try {
        if (!obj || typeof obj !== 'object') return '';
        const candidates = [
          obj.minecraftUuid,
          obj.minecraft_uuid,
          obj.minecraftUUID,
          obj.mcUuid,
          obj.mc_uuid,
          obj.uuid,
        ];
        for (const c of candidates) {
          if (c !== undefined && c !== null && String(c).trim()) return String(c).trim();
        }
        return '';
      } catch (e) {
        return '';
      }
    }

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
          faceUrl: u.faceUrl || u.face_url || u.face || u.face_key || '',
          mcUuid: extractMinecraftUuid(u),
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

    function enterGroupMode() {
      groupMode.value = true;
      groupName.value = '';
      for (const k of Object.keys(selectedMap)) delete selectedMap[k];
    }

    function cancelGroupMode() {
      groupMode.value = false;
      groupName.value = '';
      for (const k of Object.keys(selectedMap)) delete selectedMap[k];
    }

    function isSelected(userId) {
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      return id ? !!selectedMap[id] : false;
    }

    function setSelected(userId, val) {
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      if (!id) return;
      selectedMap[id] = !!val;
    }

    const selectedCount = computed(() => {
      try {
        return Object.values(selectedMap).filter(Boolean).length;
      } catch (e) {
        return 0;
      }
    });

    async function createGroupChat() {
      if (createGroupLoading.value) return;
      const picked = Object.entries(selectedMap)
        .filter(([, v]) => !!v)
        .map(([k]) => String(k));
      const selfId = selfUserId.value ? String(selfUserId.value) : null;
      const members = picked.filter((id) => !selfId || String(id) !== String(selfId));
      if (members.length < 2) {
        ElementPlus.ElMessage.warning('创建群聊需要至少选择 2 位其他玩家');
        return;
      }

      createGroupLoading.value = true;
      try {
        const base = String(apiBase.value || '').replace(/\/$/, '');
        const res = await safeFetch(`${base}/chats/group`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: (groupName.value || '').trim() || null, members }),
        });
        if (!res.ok) throw new Error('创建群聊失败');
        const chat = await res.json().catch(() => null);
        const chatId =
          (chat && (chat.id || chat.chatId)) ||
          (chat && chat.chat && (chat.chat.id || chat.chat.chatId)) ||
          null;
        if (!chatId) throw new Error('no chatId');
        window.location.href = `/m/chat_detail.html?chat=${encodeURIComponent(chatId)}`;
      } catch (e) {
        ElementPlus.ElMessage.error('创建群聊失败');
      } finally {
        createGroupLoading.value = false;
      }
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
      usersLoading.value = true;
      try {
        await fetchConfig();
        await resolveSelfProfile();
        await loadUsers();
      } finally {
        usersLoading.value = false;
      }
    });

    return {
      users,
      filtered,
      q,
      openChat,
      onInput,
      usersLoading,
      // group
      selfUserId,
      groupMode,
      groupName,
      selectedCount,
      createGroupLoading,
      enterGroupMode,
      cancelGroupMode,
      isSelected,
      setSelected,
      createGroupChat,
    };
  },
});

try {
  const icons = window.ElementPlusIconsVue;
  if (icons && typeof icons === 'object') {
    for (const [key, component] of Object.entries(icons)) {
      app.component(key, component);
    }
  }
} catch (e) {}

app.use(ElementPlus).mount('#app');
