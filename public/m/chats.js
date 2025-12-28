// Mobile chats list page
const { createApp, ref, reactive, computed, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const chats = ref([]);
    const chatUnreadMap = reactive({});
    const selfUserId = ref(null);
    const selfFaceUrl = ref('');
    const userNameCache = reactive({});
    const userFaceCache = reactive({});
    const userFetchInFlight = reactive({});

    const socket = ref(null);
    const joinedRooms = reactive({});

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

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

    function authHeaders() {
      const h = {};
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options, allowRetry) {
      const opt = Object.assign({ credentials: 'include' }, options || {});
      opt.headers = Object.assign({}, opt.headers || {}, authHeaders());

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

    function extractFaceUrl(u) {
      try {
        if (!u || typeof u !== 'object') return '';
        return String(u.faceUrl || u.face_url || u.face || u.avatarUrl || u.avatar_url || u.avatar || '') || '';
      } catch (e) {
        return '';
      }
    }

    async function fetchUserById(userId) {
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      if (!id) return null;
      if (userNameCache[id] || userFaceCache[id]) return { id };
      if (userFetchInFlight[id]) return userFetchInFlight[id];

      userFetchInFlight[id] = (async () => {
        try {
          // Required by spec: /api/user/:id (apiBase is usually /api)
          const res = await safeFetch(`${apiBase.value}/user/${encodeURIComponent(id)}`);
          if (!res.ok) return null;
          const u = await res.json().catch(() => null);
          if (!u || typeof u !== 'object') return null;
          const uid = String(u.id || id);
          userNameCache[uid] = u.username || u.displayName || u.name || userNameCache[uid] || uid;
          const face = extractFaceUrl(u);
          if (face) userFaceCache[uid] = face;
          return u;
        } catch (e) {
          return null;
        } finally {
          try {
            delete userFetchInFlight[id];
          } catch (e) {
            userFetchInFlight[id] = null;
          }
        }
      })();

      return userFetchInFlight[id];
    }

    async function loadChats() {
      try {
        const res = await safeFetch(`${apiBase.value}/chats`);
        if (!res.ok) return;
        chats.value = await res.json();
      } catch (e) {}
    }

    function normalizeChatIdFromMessage(m) {
      try {
        if (!m || typeof m !== 'object') return null;
        const raw = m.chatId || m.chat_id || m.chat || null;
        if (!raw) return null;
        if (typeof raw === 'object') {
          const id = raw.id || raw.chatId || raw.chat_id;
          return id !== undefined && id !== null && String(id) ? String(id) : null;
        }
        return String(raw);
      } catch (e) {
        return null;
      }
    }

    function connectSocket() {
      try {
        if (socket.value && socket.value.connected) return;
        if (typeof window === 'undefined' || !window.io) return;

        const opts = {
          path: '/api/socket.io',
          transports: ['websocket', 'polling'],
          withCredentials: true,
        };
        const t = tokenValue();
        if (t) opts.auth = { token: t };

        const s = window.io(window.location.origin, opts);
        socket.value = s;

        s.on('connect', () => {
          try {
            joinAllChatRooms();
          } catch (e) {}
        });

        s.on('connect_error', (err) => {
          const msg = err && err.message ? String(err.message) : String(err || '');
          if (/invalid token/i.test(msg)) {
            try { clearBadToken(); } catch (e) {}
            try { s.disconnect(); } catch (e) {}
            try {
              const s2 = window.io(window.location.origin, {
                path: '/api/socket.io',
                transports: ['websocket', 'polling'],
                withCredentials: true,
              });
              socket.value = s2;
            } catch (e) {}
          }
        });

        s.on('message.created', async (msg) => {
          try {
            const chatId = normalizeChatIdFromMessage(msg);
            if (!chatId || chatId === 'global') return;

            const list = Array.isArray(chats.value) ? chats.value : [];
            const chat = list.find((c) => c && String(c.id) === String(chatId));

            if (!chat) {
              await loadChats();
              joinAllChatRooms();
              await hydrateChatPeerProfiles();
              return;
            }

            chat.lastMessage = msg;

            // Per requirement: mark unread for any new message (including our own echo).
            chatUnreadMap[String(chatId)] = true;

            // Ensure peer avatar/name are available for this chat
            try {
              const members = chat.members || chat.memberIds || [];
              if (Array.isArray(members) && members.length === 2 && selfUserId.value) {
                const otherId = members.find((m) => String(m) !== String(selfUserId.value));
                if (otherId) await fetchUserById(otherId);
              }
            } catch (e) {}
          } catch (e) {}
        });
      } catch (e) {
        // ignore
      }
    }

    function joinRoom(chatId) {
      try {
        if (!socket.value || !socket.value.connected) return;
        if (!chatId) return;
        const id = String(chatId);
        if (joinedRooms[id]) return;
        socket.value.emit('join', id);
        joinedRooms[id] = true;
      } catch (e) {}
    }

    function joinAllChatRooms() {
      try {
        const list = Array.isArray(chats.value) ? chats.value : [];
        list.forEach((c) => {
          if (c && c.id) joinRoom(c.id);
        });
      } catch (e) {}
    }

    async function hydrateChatPeerProfiles() {
      try {
        const me = selfUserId.value;
        const list = Array.isArray(chats.value) ? chats.value : [];
        const ids = new Set();
        for (const chat of list) {
          const members = (chat && (chat.members || chat.memberIds)) || [];
          if (!Array.isArray(members) || members.length !== 2 || !me) continue;
          const otherId = members.find((m) => String(m) !== String(me));
          if (!otherId) continue;
          const oid = String(otherId);
          if (!userFaceCache[oid] || !userNameCache[oid]) ids.add(oid);
        }
        await Promise.all(Array.from(ids).map((id) => fetchUserById(id)));
      } catch (e) {}
    }

    async function resolveSelfProfile() {
      try {
        // Prefer /users/me (matches desktop); fallback /me
        let res = await safeFetch(`${apiBase.value}/users/me`);
        if (!res.ok && res.status === 404) res = await safeFetch(`${apiBase.value}/me`);
        if (!res.ok) return;
        const me = await res.json().catch(() => null);
        if (!me || typeof me !== 'object') return;
        const id = me.id || me.userId || me.uid;
        selfUserId.value = id !== undefined && id !== null ? String(id) : null;
        const face = extractFaceUrl(me);
        if (face) selfFaceUrl.value = face;
      } catch (e) {}
    }

    function getChatName(chat) {
      if (chat.displayName) return chat.displayName;
      if (chat.name) return chat.name;
      
      const members = chat.members || chat.memberIds || [];
      if (members.length === 2 && selfUserId.value) {
        const otherId = members.find(m => String(m) !== String(selfUserId.value));
        if (otherId && userNameCache[otherId]) {
          return userNameCache[otherId];
        }
      }
      return members.join(',') || chat.id;
    }

    function getChatAvatar(chat) {
      const members = chat.members || chat.memberIds || [];
      if (members.length === 2 && selfUserId.value) {
        const otherId = members.find(m => String(m) !== String(selfUserId.value));
        if (otherId && userFaceCache[otherId]) {
          return userFaceCache[otherId];
        }
      }
      return '';
    }

    function getChatInitial(chat) {
      const name = getChatName(chat);
      return name ? name.charAt(0).toUpperCase() : '?';
    }

    function formatLastMessage(chat) {
      if (!chat || !chat.lastMessage) return '';
      const msg = chat.lastMessage;
      const content = msg.content;
      
      if (msg.type === 'text') {
        const text = (content && (content.text !== undefined ? content.text : content)) || '';
        const str = String(text);
        return str.length > 20 ? str.substring(0, 20) + '...' : str;
      }
      if (msg.type === 'emoji') return '[表情]';
      if (msg.type === 'file') return '[文件]';
      return '';
    }

    function hasUnread(chatId) {
      const id = chatId !== undefined && chatId !== null ? String(chatId) : '';
      return id ? !!chatUnreadMap[id] : false;
    }

    function openGlobal() {
      window.location.href = '/m/chat_detail.html?chat=global';
    }

    function openChat(chat) {
      try {
        if (chat && chat.id) delete chatUnreadMap[String(chat.id)];
      } catch (e) {}
      window.location.href = `/m/chat_detail.html?chat=${encodeURIComponent(chat.id)}`;
    }

    onMounted(async () => {
      await fetchConfig();
      await resolveSelfProfile();
      await loadChats();
      await hydrateChatPeerProfiles();

      connectSocket();
      joinAllChatRooms();
    });

    return {
      chats,
      selfFaceUrl,
      getChatName,
      getChatAvatar,
      getChatInitial,
      formatLastMessage,
      hasUnread,
      openGlobal,
      openChat,
    };
  },
}).use(ElementPlus).mount('#app');
