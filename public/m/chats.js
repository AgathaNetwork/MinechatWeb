// Mobile chats list page
const { createApp, ref, reactive, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const chats = ref([]);
    const chatsLoading = ref(false);
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

    function normalizeFaceUrl(raw) {
      try {
        const u = String(raw || '').trim();
        if (!u) return '';
        if (/^(data:|blob:|https?:\/\/)/i.test(u)) return u;
        if (u.startsWith('/api/')) return u;
        if (u.startsWith('/')) {
          const base = String(apiBase.value || '').replace(/\/$/, '');
          if (base && base !== '/') return base + u;
          return u;
        }
        // relative without leading slash
        const base = String(apiBase.value || '').replace(/\/$/, '');
        if (base && base !== '/') return base + '/' + u;
        return u;
      } catch (e) {
        return '';
      }
    }

    function extractFaceUrl(u) {
      try {
        if (!u || typeof u !== 'object') return '';
        const raw = u.faceUrl || u.face_url || u.face || u.avatarUrl || u.avatar_url || u.avatar || '';
        return normalizeFaceUrl(raw);
      } catch (e) {
        return '';
      }
    }

    function extractChatAvatarUrl(chat) {
      try {
        if (!chat || typeof chat !== 'object') return '';
        const raw = chat.avatarUrl || chat.avatar_url || chat.avatar || '';
        return normalizeFaceUrl(raw);
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
          // Prefer /users/:id (matches desktop); fallback /user/:id if backend uses singular.
          let res = await safeFetch(`${apiBase.value}/users/${encodeURIComponent(id)}`);
          if (!res.ok && res.status === 404) {
            res = await safeFetch(`${apiBase.value}/user/${encodeURIComponent(id)}`);
          }
          if (!res.ok) return null;
          const u = await res.json().catch(() => null);
          if (!u || typeof u !== 'object') return null;
          const uid = String(u.id || id);
          userNameCache[uid] = u.username || u.displayName || u.name || userNameCache[uid] || '未知玩家';
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
        chats.value = sortChatsList(await res.json());
      } catch (e) {}
    }

    function parseAnyTimeToMs(v) {
      try {
        if (v === undefined || v === null || v === '') return 0;
        if (typeof v === 'number') {
          const ms = v < 1e12 ? v * 1000 : v;
          return Number.isFinite(ms) ? ms : 0;
        }
        const s = String(v);
        if (!s) return 0;
        if (/^\d+$/.test(s)) {
          const num = Number(s);
          const ms = num < 1e12 ? num * 1000 : num;
          return Number.isFinite(ms) ? ms : 0;
        }
        const d = new Date(s);
        const ms = d.getTime();
        return Number.isFinite(ms) ? ms : 0;
      } catch (e) {
        return 0;
      }
    }

    function messageTimeMs(m) {
      if (!m || typeof m !== 'object') return 0;
      const v = m.createdAt ?? m.created_at ?? m.sentAt ?? m.sent_at ?? m.timestamp ?? m.time ?? m.ts;
      return parseAnyTimeToMs(v);
    }

    function chatLastActivityMs(chat) {
      try {
        if (!chat || typeof chat !== 'object') return 0;
        const lm = chat.lastMessage;
        const t = messageTimeMs(lm);
        if (t) return t;
        const v =
          chat.updatedAt ??
          chat.updated_at ??
          chat.lastActiveAt ??
          chat.last_active_at ??
          chat.createdAt ??
          chat.created_at;
        return parseAnyTimeToMs(v);
      } catch (e) {
        return 0;
      }
    }

    function sortChatsList(list) {
      const arr = Array.isArray(list) ? list.slice() : [];
      const filtered = arr.filter((c) => c && String(c.id) !== 'global');
      filtered.sort((a, b) => chatLastActivityMs(b) - chatLastActivityMs(a));
      return filtered;
    }

    function resortChats() {
      try {
        chats.value = sortChatsList(chats.value);
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

        function extractChatFromPayload(payload) {
          try {
            if (!payload) return null;
            if (payload.chat && typeof payload.chat === 'object') return payload.chat;
            if (payload.data && payload.data.chat && typeof payload.data.chat === 'object') return payload.data.chat;
            if (payload.id && payload.type) return payload;
            return null;
          } catch (e) {
            return null;
          }
        }

        function extractChatIdFromPayload(payload) {
          try {
            if (!payload) return null;
            const cid = payload.chatId || payload.chat_id || payload.id;
            if (cid !== undefined && cid !== null && String(cid)) return String(cid);
            const chat = extractChatFromPayload(payload);
            if (chat && (chat.id !== undefined && chat.id !== null)) return String(chat.id);
            return null;
          } catch (e) {
            return null;
          }
        }

        function normalizeIncomingChat(chat) {
          try {
            if (!chat || typeof chat !== 'object') return null;
            const c = Object.assign({}, chat);
            if (c.id !== undefined && c.id !== null) c.id = String(c.id);
            const t = String(c.type || '').toLowerCase();
            if (t === 'group') {
              if (!c.displayName) c.displayName = c.name || '群聊';
            }
            return c;
          } catch (e) {
            return null;
          }
        }

        function upsertChatInList(incomingChat) {
          try {
            const c = normalizeIncomingChat(incomingChat);
            if (!c || !c.id) return;

            // Safety: only accept chats we are a member of (if members are present).
            try {
              const me = selfUserId.value ? String(selfUserId.value) : null;
              const members = c.members || c.memberIds;
              if (me && Array.isArray(members) && members.length > 0) {
                if (!members.map(String).includes(me)) return;
              }
            } catch (e2) {}

            const list = Array.isArray(chats.value) ? chats.value : [];
            const idx = list.findIndex((x) => x && String(x.id) === String(c.id));
            if (idx >= 0) {
              const existing = list[idx] || {};
              const merged = Object.assign({}, existing, c);
              if (existing.lastMessage && !merged.lastMessage) merged.lastMessage = existing.lastMessage;
              list.splice(idx, 1, merged);
            } else {
              list.push(c);
            }
            chats.value = list;
            resortChats();
          } catch (e) {}
        }

        function removeChatFromList(chatId) {
          try {
            const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
            if (!cid) return;
            chats.value = (chats.value || []).filter((c) => c && String(c.id) !== cid);
            try { delete chatUnreadMap[cid]; } catch (e) {}
            try { delete joinedRooms[cid]; } catch (e) {}
          } catch (e) {}
        }

        const rawApiBase = String(apiBase.value || '').trim();
        const useDirect = /^https?:\/\//i.test(rawApiBase);
        let socketUrl = window.location.origin;
        try {
          if (useDirect) socketUrl = new URL(rawApiBase).origin;
        } catch (e) {
          if (useDirect) socketUrl = rawApiBase.replace(/\/$/, '');
        }
        const socketPath = useDirect ? '/socket.io' : '/api/socket.io';

        const opts = {
          path: socketPath,
          transports: ['websocket', 'polling'],
          withCredentials: true,
        };
        const t = tokenValue();
        if (t) opts.auth = { token: t };

        const s = window.io(socketUrl, opts);
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
              const s2 = window.io(socketUrl, {
                path: socketPath,
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

            // Unread: only for messages from others.
            const fromUser = msg && (msg.from_user || msg.fromUser || msg.from);
            const isSelfMsg = !!(selfUserId.value && fromUser && String(fromUser) === String(selfUserId.value));
            if (!isSelfMsg) chatUnreadMap[String(chatId)] = true;

            resortChats();

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

        function onMessageUpdatedLike(payload) {
          try {
            const updated = payload && payload.message ? payload.message : payload;
            if (!updated || typeof updated !== 'object') return;
            const chatId = normalizeChatIdFromMessage(updated) || (payload && (payload.chatId || payload.chat_id));
            if (!chatId || chatId === 'global') return;

            const list = Array.isArray(chats.value) ? chats.value : [];
            const chat = list.find((c) => c && String(c.id) === String(chatId));
            if (!chat) return;

            // Only update preview if the updated message is the current lastMessage.
            if (chat.lastMessage && chat.lastMessage.id && updated.id && String(chat.lastMessage.id) === String(updated.id)) {
              chat.lastMessage = updated;
            }
          } catch (e) {}
        }

        s.on('message.recalled', onMessageUpdatedLike);
        s.on('message.updated', onMessageUpdatedLike);

        // --- Group/chat lifecycle events ---
        s.on('chat.created', async (payload) => {
          try {
            const chat = extractChatFromPayload(payload);
            if (chat) {
              upsertChatInList(chat);
            } else {
              // fallback: refresh list if payload doesn't include chat
              await loadChats();
            }
            joinAllChatRooms();
            await hydrateChatPeerProfiles();
          } catch (e) {}
        });

        s.on('chat.updated', async (payload) => {
          try {
            const chat = extractChatFromPayload(payload);
            if (chat) {
              upsertChatInList(chat);
            } else {
              // best-effort refresh
              await loadChats();
            }
            joinAllChatRooms();
            await hydrateChatPeerProfiles();
          } catch (e) {}
        });

        s.on('chat.renamed', async (payload) => {
          try {
            const chat = extractChatFromPayload(payload);
            const cid = extractChatIdFromPayload(payload);
            if (chat) {
              upsertChatInList(chat);
            } else if (cid) {
              const list = Array.isArray(chats.value) ? chats.value : [];
              const idx = list.findIndex((c) => c && String(c.id) === String(cid));
              if (idx >= 0) {
                const name = payload && (payload.name !== undefined ? payload.name : payload.chatName);
                if (name !== undefined) {
                  const merged = Object.assign({}, list[idx], { name });
                  if (String(merged.type || '').toLowerCase() === 'group') {
                    merged.displayName = name || '群聊';
                  }
                  list.splice(idx, 1, merged);
                  chats.value = list;
                  resortChats();
                }
              }
            }
          } catch (e) {}
        });

        async function onChatStructureChanged(payload) {
          try {
            // members/admins/owner changes can affect permissions & displayName; simplest is reload list.
            await loadChats();
            joinAllChatRooms();
            await hydrateChatPeerProfiles();
          } catch (e) {}
        }

        s.on('chat.members.added', onChatStructureChanged);
        s.on('chat.members.removed', onChatStructureChanged);
        s.on('chat.admins.changed', onChatStructureChanged);
        s.on('chat.owner.changed', onChatStructureChanged);

        function onChatRemovedLike(payload, tip) {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (cid) removeChatFromList(cid);
            try {
              if (tip && ElementPlus && ElementPlus.ElMessage) ElementPlus.ElMessage.warning(tip);
            } catch (e2) {}
          } catch (e) {}
        }

        s.on('chat.dissolved', (p) => onChatRemovedLike(p, '群聊已解散'));
        s.on('chat.deleted', (p) => onChatRemovedLike(p, '会话已删除'));
        s.on('chat.kicked', (p) => onChatRemovedLike(p, '你已被移出群聊'));
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
        if (selfUserId.value) {
          userNameCache[String(selfUserId.value)] = me.username || me.displayName || me.name || userNameCache[String(selfUserId.value)] || String(selfUserId.value);
        }
        const face = extractFaceUrl(me);
        if (face) {
          selfFaceUrl.value = face;
          if (selfUserId.value) userFaceCache[String(selfUserId.value)] = face;
        }
      } catch (e) {}
    }

    function getChatPeerId(chat) {
      try {
        if (!chat || typeof chat !== 'object') return null;
        const members = Array.isArray(chat.members)
          ? chat.members
          : Array.isArray(chat.memberIds)
            ? chat.memberIds
            : null;
        if (!selfUserId.value) return null;
        const selfId = String(selfUserId.value);

        // Self-chat may be represented as [self] or [self, self]
        if (members && members.length === 1) {
          return String(members[0]) === selfId ? selfId : null;
        }
        if (members && members.length === 2) {
          const a = String(members[0]);
          const b = String(members[1]);
          if (a === selfId && b === selfId) return selfId;
          const otherId = [a, b].find((mid) => mid !== selfId);
          return otherId ? String(otherId) : null;
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    function getChatName(chat) {
      if (chat.displayName) return chat.displayName;
      if (chat.name) return chat.name;

      try {
        const t = chat.type !== undefined && chat.type !== null ? String(chat.type).toLowerCase() : '';
        if (t === 'group') return '群聊';
      } catch (e) {}
      
      const peerId = getChatPeerId(chat);
      if (peerId && selfUserId.value && String(peerId) === String(selfUserId.value)) {
        return '我';
      }
      if (peerId && userNameCache[peerId]) return userNameCache[peerId];

      return '会话';
    }

    function getChatAvatar(chat) {
      try {
        const t = chat && chat.type !== undefined && chat.type !== null ? String(chat.type).toLowerCase() : '';
        if (t === 'group') {
          const a = extractChatAvatarUrl(chat);
          if (a) return a;
        }
      } catch (e) {}

      const peerId = getChatPeerId(chat);
      if (!peerId) return '';
      if (selfUserId.value && String(peerId) === String(selfUserId.value)) {
        return selfFaceUrl.value || userFaceCache[String(peerId)] || '';
      }
      return userFaceCache[String(peerId)] || '';
    }

    function getChatInitial(chat) {
      const name = getChatName(chat);
      return name ? name.charAt(0).toUpperCase() : '?';
    }

    function previewFromStructuredContent(content) {
      try {
        if (!content || typeof content !== 'object') return '';
        if (content.text !== undefined && content.text !== null) return String(content.text);
        if (content.packId || content.pack_id) return '[表情]';
        if (content.key && /^image\//i.test(String(content.key))) return '[表情]';
        const mime = content.mimetype || content.type || '';
        if (mime && /^image\//i.test(String(mime))) return '[图片]';
        if (mime && /^video\//i.test(String(mime))) return '[视频]';
        if (content.filename) return '[文件]';
        const url = content.url || content.thumbnailUrl || content.downloadUrl || '';
        if (url) {
          const u = String(url);
          if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return '[图片]';
          if (/\.(mp4|webm|mov|mkv)(\?|#|$)/i.test(u)) return '[视频]';
          return '[文件]';
        }
        return '[富文本]';
      } catch (e) {
        return '[富文本]';
      }
    }

    function formatLastMessage(chat) {
      if (!chat || !chat.lastMessage) return '';
      const msg = chat.lastMessage;
      const content = msg.content;

      try {
        if (String(msg.type || '') === 'recalled') return '[消息已撤回]';
        if (content && typeof content === 'object' && content.recalled === true) return '[消息已撤回]';
      } catch (e) {}
      
      if (msg.type === 'text') {
        if (content && typeof content === 'object') {
          const p = previewFromStructuredContent(content);
          return p.length > 20 ? p.substring(0, 20) + '...' : p;
        }
        const text = (content && (content.text !== undefined ? content.text : content)) || '';
        const str = String(text);
        return str.length > 20 ? str.substring(0, 20) + '...' : str;
      }
      if (msg.type === 'emoji') return '[表情]';
      if (msg.type === 'file') return '[文件]';
      return '';
    }

    function isRecalledMessage(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (String(m.type || '') === 'recalled') return true;
        const c = m.content;
        if (c && typeof c === 'object' && c.recalled === true) return true;
        return false;
      } catch (e) {
        return false;
      }
    }

    function previewTagAndSuffixFromMessage(m) {
      try {
        if (!m || typeof m !== 'object') return { tag: '', suffix: '' };
        if (isRecalledMessage(m)) return { tag: '已撤回', suffix: '' };

        const t = String(m.type || '').toLowerCase();
        if (t === 'emoji' || t === 'sticker') {
          const fn = m.content && m.content.filename ? String(m.content.filename) : '';
          return { tag: '表情', suffix: fn };
        }
        if (t === 'file') {
          const mime = m.content && (m.content.mimetype || m.content.type) ? String(m.content.mimetype || m.content.type) : '';
          const fn = m.content && m.content.filename ? String(m.content.filename) : '';
          const tag = /^image\//i.test(mime) ? '图片' : /^video\//i.test(mime) ? '视频' : '文件';
          return { tag, suffix: fn };
        }

        return { tag: '', suffix: '' };
      } catch (e) {
        return { tag: '', suffix: '' };
      }
    }

    function lastMessagePreviewTag(chat) {
      try {
        if (!chat || !chat.lastMessage) return '';
        return previewTagAndSuffixFromMessage(chat.lastMessage).tag || '';
      } catch (e) {
        return '';
      }
    }

    function lastMessagePreviewSuffix(chat) {
      try {
        if (!chat || !chat.lastMessage) return '';
        return previewTagAndSuffixFromMessage(chat.lastMessage).suffix || '';
      } catch (e) {
        return '';
      }
    }

    function isGroupChatItem(chat) {
      try {
        if (!chat) return false;
        return String(chat.type || '').toLowerCase() === 'group';
      } catch (e) {
        return false;
      }
    }

    function lastMessageSenderBadge(chat) {
      try {
        if (!isGroupChatItem(chat)) return '';
        const lm = chat && chat.lastMessage;
        if (!lm || typeof lm !== 'object') return '';
        const from = lm.from_user || lm.fromUser || lm.from || '';
        if (!from) return '';
        if (selfUserId.value && String(from) === String(selfUserId.value)) return '我';

        const id = String(from);
        const name = userNameCache[id];
        if (name && name !== '未知玩家') return String(name);

        // Best-effort: trigger fetch so the UI can update later.
        try {
          fetchUserById(id);
        } catch (e) {}
        return '未知玩家';
      } catch (e) {
        return '';
      }
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
      chatsLoading.value = true;
      try {
        await fetchConfig();
        await resolveSelfProfile();
        await loadChats();
        await hydrateChatPeerProfiles();
      } finally {
        chatsLoading.value = false;
      }

      connectSocket();
      joinAllChatRooms();

      // If user navigates back to this page, the browser may restore it from BFCache and
      // skip onMounted(). Ensure the list is refreshed so newly created chats show up.
      try {
        window.addEventListener('pageshow', async (ev) => {
          try {
            if (!ev || !ev.persisted) return;
            await loadChats();
            await hydrateChatPeerProfiles();
            connectSocket();
            joinAllChatRooms();
          } catch (e) {}
        });
      } catch (e) {}
    });

    return {
      chats,
      chatsLoading,
      selfFaceUrl,
      getChatName,
      getChatAvatar,
      getChatInitial,
      formatLastMessage,
      lastMessagePreviewTag,
      lastMessagePreviewSuffix,
      isGroupChatItem,
      lastMessageSenderBadge,
      hasUnread,
      openGlobal,
      openChat,
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
