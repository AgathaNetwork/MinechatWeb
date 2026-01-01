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

    const briefDialogVisible = ref(false);
    const briefLoading = ref(false);
    const briefError = ref('');
    const briefRows = ref([]);
    const briefDisplayName = ref('');
    const briefUuid = ref('');
    const briefFaceUrl = ref('');
    const briefInitial = ref('');

    function parseDate(v) {
      try {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') {
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        }
        const s = String(v).trim();
        if (!s) return null;
        const n = Number(s);
        if (!Number.isNaN(n) && n > 0 && s.length >= 10) {
          const d = new Date(n);
          if (!isNaN(d.getTime())) return d;
        }
        const d2 = new Date(s);
        return isNaN(d2.getTime()) ? null : d2;
      } catch (e) {
        return null;
      }
    }

    function formatYmd(d) {
      try {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      } catch (e) {
        return '';
      }
    }

    function formatYmdHm(d) {
      try {
        const ymd = formatYmd(d);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return ymd ? `${ymd} ${hh}:${mm}` : '';
      } catch (e) {
        return '';
      }
    }

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

    async function openBrief(user) {
      briefDialogVisible.value = true;
      briefLoading.value = true;
      briefError.value = '';
      briefRows.value = [];

      const name = user && (user.username || user.id) ? String(user.username || user.id) : '';
      const uuid = user && (user.mcUuid || user.minecraftUuid || user.uuid) ? String(user.mcUuid || user.minecraftUuid || user.uuid) : '';
      const face = user && (user.faceUrl || user.face_url || user.face) ? String(user.faceUrl || user.face_url || user.face) : '';

      briefDisplayName.value = name || '未知玩家';
      briefUuid.value = uuid || '';
      briefFaceUrl.value = face || '';
      briefInitial.value = (briefDisplayName.value || '?').slice(0, 1).toUpperCase();

      if (!name) {
        briefError.value = '缺少用户名';
        briefLoading.value = false;
        return;
      }

      try {
        const res = await safeFetch(`${apiBase.value}/info/playerBrief?username=${encodeURIComponent(name)}`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== 'object' || Number(data.return) !== 1) {
          briefError.value = '未查询到玩家信息';
          return;
        }

        const levelText = data.level === null || data.level === undefined || data.level === '' ? '-' : String(data.level);
        const regDt = parseDate(data.regDate);
        const lastDt = parseDate(data.lastLogin);
        briefRows.value = [
          { k: '等级', v: levelText },
          { k: '注册时间', v: regDt ? formatYmd(regDt) : '-' },
          { k: '上次上线', v: lastDt ? formatYmdHm(lastDt) : '-' },
        ];
      } catch (e) {
        briefError.value = e && e.message ? e.message : String(e);
      } finally {
        briefLoading.value = false;
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
      openBrief,
      onInput,
      usersLoading,

      // brief dialog
      briefDialogVisible,
      briefLoading,
      briefError,
      briefRows,
      briefDisplayName,
      briefUuid,
      briefFaceUrl,
      briefInitial,

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
