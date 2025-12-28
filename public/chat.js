// Vue 3 + Element Plus chat page
const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);

    const chats = ref([]);
    const chatUnreadMap = reactive({});
    const currentChatId = ref(null);
    const currentChatTitle = ref('');
    const currentChatFaceUrl = ref('');

    const messages = ref([]);
    const msgById = reactive({});
    const userNameCache = reactive({});
    const userFaceCache = reactive({});

    const selfFaceUrl = ref('');
    const usersIndexLoaded = ref(false);

    const loadingMore = ref(false);
    const noMoreBefore = ref(false);
    const PAGE_LIMIT = 20;

    const replyTarget = ref(null);

    const ctxMenuVisible = ref(false);
    const ctxMenuX = ref(0);
    const ctxMenuY = ref(0);
    const ctxMenuMsg = ref(null);

    const emojiPanelVisible = ref(false);
    const emojiPacks = ref([]);

    const msgInput = ref('');

    const selfUserId = ref(null);

    const fileInputEl = ref(null);

    const messagesEl = ref(null);
    const chatLoading = ref(false);

    const isGlobalChat = computed(() => currentChatId.value === 'global');
    const isLoggedIn = computed(() => !!token.value || !!sessionOk.value);

    const socket = ref(null);
    const joinedChatId = ref(null);

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

    function normalizeChatIdFromMessage(m) {
      if (!m || typeof m !== 'object') return null;
      return m.chatId || m.chat_id || m.chat || null;
    }

    function isScrolledNearBottom(el) {
      try {
        if (!el) return true;
        const threshold = 120;
        return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      } catch (e) {
        return true;
      }
    }

    function upsertIncomingMessage(msg) {
      if (!msg || typeof msg !== 'object') return;

      // normalize fields so UI can render
      normalizeMessage(msg, currentChatId.value === 'global');

      const id = msg.id;
      if (!id) return;

      // If we already have the message, merge/update in place
      if (msgById[id]) {
        const prev = msgById[id];
        Object.assign(prev, msg);
        return;
      }

      msgById[id] = msg;
      messages.value = messages.value.concat([msg]);
    }

    function contentSignature(m) {
      try {
        if (!m) return '';
        if (m.type === 'text') {
          const t = (m.content && (m.content.text !== undefined ? m.content.text : m.content)) || '';
          return 'text:' + String(t);
        }
        if (m.type === 'emoji') {
          const pid = m.content && (m.content.packId || m.content.pack_id) || '';
          const url = m.content && m.content.url || '';
          return 'emoji:' + String(pid) + ':' + String(url);
        }
        if (m.type === 'file') {
          const fn = m.content && m.content.filename || '';
          const mm = m.content && (m.content.mimetype || m.content.type) || '';
          return 'file:' + String(fn) + ':' + String(mm);
        }
        return String(m.type || '') + ':' + messageTextPreview(m);
      } catch (e) {
        return '';
      }
    }

    function findOptimisticForAck(serverMsg) {
      try {
        if (!serverMsg || typeof serverMsg !== 'object') return null;
        normalizeMessage(serverMsg, currentChatId.value === 'global');
        if (!selfUserId.value) return null;
        if (!serverMsg.from_user) return null;
        if (String(serverMsg.from_user) !== String(selfUserId.value)) return null;

        const sig = contentSignature(serverMsg);
        const now = parseMessageTime(serverMsg) ? parseMessageTime(serverMsg).getTime() : Date.now();

        const arr = messages.value || [];
        for (let i = arr.length - 1; i >= 0; i--) {
          const m = arr[i];
          if (!m || !m.id) continue;
          if (m.__status !== 'sending') continue;
          if (m.__own !== true) continue;
          if (m.type !== serverMsg.type) continue;

          const ms = parseMessageTime(m) ? parseMessageTime(m).getTime() : Date.now();
          if (Math.abs(now - ms) > 60 * 1000) continue;
          if (contentSignature(m) !== sig) continue;

          return m;
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    function ackOptimisticMessage(tempId, serverMsg, isGlobal) {
      try {
        const optimistic = msgById[tempId];
        if (!optimistic) return;
        if (!serverMsg || typeof serverMsg !== 'object') {
          optimistic.__status = 'sent';
          return;
        }
        normalizeMessage(serverMsg, !!isGlobal);
        const serverId = serverMsg.id;
        if (!serverId) {
          optimistic.__status = 'sent';
          return;
        }

        // If the server message already exists (socket came first), drop optimistic one.
        if (msgById[serverId]) {
          try {
            Object.assign(msgById[serverId], serverMsg);
            msgById[serverId].__status = 'sent';
          } catch (e) {}
          if (tempId !== serverId) {
            removeMessageById(tempId);
          }
          return;
        }

        // Move optimistic mapping from tempId -> serverId to prevent duplicates.
        delete msgById[tempId];

        optimistic.__status = 'sent';
        optimistic.id = serverId;
        optimistic.createdAt = serverMsg.created_at || serverMsg.createdAt || optimistic.createdAt;
        if (serverMsg.type) optimistic.type = serverMsg.type;
        if (serverMsg.from_user) optimistic.from_user = serverMsg.from_user;
        if (serverMsg.replied_to !== undefined) optimistic.replied_to = serverMsg.replied_to;
        if (serverMsg.content !== undefined) {
          if (optimistic.type === 'file' && optimistic.content && optimistic.content.__localUrl) {
            const localUrl = optimistic.content.__localUrl;
            optimistic.content = Object.assign({}, serverMsg.content);
            optimistic.content.__localUrl = localUrl;
          } else {
            optimistic.content = serverMsg.content;
          }
        }

        msgById[serverId] = optimistic;
      } catch (e) {
        // ignore
      }
    }

    function removeMessageById(messageId) {
      if (!messageId) return;
      if (msgById[messageId]) delete msgById[messageId];
      messages.value = (messages.value || []).filter((m) => m && m.id !== messageId);
    }

    async function ensureUserCachesForMessages(msgs, isGlobal) {
      try {
        const ids = new Set();
        (msgs || []).forEach((m) => {
          if (!m) return;
          normalizeMessage(m, isGlobal);
          if (m.from_user) ids.add(m.from_user);
          if (!isGlobal && m.replied_to) {
            const ref = typeof m.replied_to === 'object' ? m.replied_to : msgById[m.replied_to];
            if (ref && ref.from_user) ids.add(ref.from_user);
          }
        });
        await fetchMissingUserNames(ids);
      } catch (e) {}
    }

    function connectSocket() {
      try {
        if (socket.value && socket.value.connected) return;
        if (typeof window === 'undefined' || !window.io) return;

        // Always connect to current origin and go through /api proxy for socket.io path.
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
          // Join current chat room if already selected
          try {
            if (currentChatId.value && currentChatId.value !== joinedChatId.value) {
              s.emit('join', currentChatId.value);
              joinedChatId.value = currentChatId.value;
            }
          } catch (e) {}
        });

        s.on('connect_error', (err) => {
          const msg = (err && err.message) ? String(err.message) : String(err || '');
          // If token is invalid, drop it and retry relying on session cookie.
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
            const current = currentChatId.value;
            
            // 更新会话列表的最新消息和未读状态
            if (chatId && chatId !== 'global') {
              const chat = (chats.value || []).find(c => c && String(c.id) === String(chatId));
              if (chat) {
                chat.lastMessage = msg;
                // 如果不是当前打开的会话，标记为未读
                if (!current || String(chatId) !== String(current)) {
                  chatUnreadMap[chatId] = true;
                }
              }
            }
            
            if (!current) return;
            if (chatId && String(chatId) !== String(current)) return;

            // If this is an echo of our optimistic send, treat it as ACK and merge.
            const candidate = findOptimisticForAck(msg);
            if (candidate && candidate.id) {
              ackOptimisticMessage(candidate.id, msg, current === 'global');
              await ensureUserCachesForMessages([msg], current === 'global');
              return;
            }

            const stickToBottom = isScrolledNearBottom(messagesEl.value);
            upsertIncomingMessage(msg);
            await ensureUserCachesForMessages([msg], current === 'global');
            await nextTick();
            if (stickToBottom && messagesEl.value) {
              messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
            }
          } catch (e) {}
        });

        s.on('message.deleted', (payload) => {
          try {
            const id = payload && (payload.id || payload.messageId);
            const chatId = payload && (payload.chatId || payload.chat_id);
            const current = currentChatId.value;
            if (chatId && current && String(chatId) !== String(current)) return;
            if (id) removeMessageById(id);
          } catch (e) {}
        });

        s.on('message.missed', async (payload) => {
          try {
            const chatId = payload && payload.chatId;
            const msgs = payload && payload.messages;
            if (!chatId || !Array.isArray(msgs)) return;
            const current = currentChatId.value;
            if (!current || String(chatId) !== String(current)) return;

            const stickToBottom = isScrolledNearBottom(messagesEl.value);
            for (const m of msgs) {
              upsertIncomingMessage(m);
            }
            await ensureUserCachesForMessages(msgs, current === 'global');
            await nextTick();
            if (stickToBottom && messagesEl.value) {
              messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
            }
          } catch (e) {}
        });
      } catch (e) {
        // ignore
      }
    }

    function leaveSocketRoom(chatId) {
      try {
        if (!socket.value) return;
        if (!chatId) return;
        socket.value.emit('leave', chatId);
      } catch (e) {}
    }

    function joinSocketRoom(chatId) {
      try {
        if (!socket.value) return;
        if (!chatId) return;
        socket.value.emit('join', chatId);
        joinedChatId.value = chatId;
      } catch (e) {}
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

    function getCachedFaceUrl(userId) {
      if (!userId) return '';
      const v = userFaceCache[String(userId)];
      return v ? String(v) : '';
    }

    function messageAuthorFaceUrl(m) {
      if (!m || isOwnMessage(m)) return '';
      const fromUser = m.from_user || m.fromUser || m.from;
      if (!fromUser) return '';
      return getCachedFaceUrl(fromUser);
    }

    function formatLastMessage(chat) {
      if (!chat || !chat.lastMessage) return '';
      const msg = chat.lastMessage;
      const text = messageTextPreview(msg);
      if (text) return text.length > 20 ? text.substring(0, 20) + '...' : text;
      if (msg.type === 'emoji') return '[表情]';
      if (msg.type === 'file') return '[文件]';
      return '';
    }

    function hasUnread(chatId) {
      return !!chatUnreadMap[chatId];
    }

    async function loadUsersIndex() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const list = await res.json().catch(() => null);
        if (!Array.isArray(list)) return;
        for (const u of list) {
          if (!u || typeof u !== 'object') continue;
          const id = u.id !== undefined && u.id !== null ? String(u.id) : '';
          if (!id) continue;
          userNameCache[id] = u.username || u.displayName || userNameCache[id] || id;
          const face = u.faceUrl || u.face_url || u.face || '';
          if (face) userFaceCache[id] = face;
        }
        usersIndexLoaded.value = true;
      } catch (e) {
        // ignore
      }
    }

    async function resolveSelfProfile() {
      // Best-effort: try /users/me (if backend provides it)
      try {
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if (res.ok) {
          const me = await res.json().catch(() => null);
          if (me && typeof me === 'object') {
            const id = me.id || me.userId || me.uid;
            if (id !== undefined && id !== null) selfUserId.value = String(id);
            const face = me.faceUrl || me.face_url || me.face;
            if (face) selfFaceUrl.value = String(face);
            const name = me.username || me.displayName;
            if (name && selfUserId.value) userNameCache[selfUserId.value] = String(name);
            return;
          }
        }
      } catch (e) {}

      // Fallback: infer id, then use users index cache
      await resolveSelfUserId();
      if (selfUserId.value) {
        const face = getCachedFaceUrl(selfUserId.value);
        if (face) selfFaceUrl.value = face;
      }
    }

    async function resolveSelfUserId() {
      // 1) Prefer extracting from JWT token (no network)
      if (token.value) {
        const payload = decodeJwtPayload(token.value);
        if (payload && typeof payload === 'object') {
          const candidate = payload.userId || payload.uid || payload.id || payload.sub;
          if (candidate) {
            selfUserId.value = String(candidate);
            return selfUserId.value;
          }
        }
      }

      // 2) Try common "me" endpoints (best-effort)
      const endpoints = ['/users/me', '/me', '/auth/me', '/api/users/me', '/api/me', '/api/auth/me'];
      for (const ep of endpoints) {
        try {
          const url = ep.startsWith('/api/') ? ep : `${apiBase.value}${ep}`;
          const res = await safeFetch(url);
          if (!res.ok) continue;
          const data = await res.json().catch(() => null);
          if (!data || typeof data !== 'object') continue;
          const candidate = data.userId || data.uid || data.id || (data.user && (data.user.id || data.user.userId));
          if (candidate) {
            selfUserId.value = String(candidate);
            return selfUserId.value;
          }
        } catch (e) {
          // ignore and continue
        }
      }

      selfUserId.value = null;
      return null;
    }

    function buildMessagesUrl(chatId, opts) {
      const before = opts && opts.beforeId ? `before=${encodeURIComponent(opts.beforeId)}&` : '';
      const limit = `limit=${encodeURIComponent(opts && opts.limit ? opts.limit : PAGE_LIMIT)}`;
      if (chatId === 'global') return `${apiBase.value}/global/messages?${before}${limit}`;
      return `${apiBase.value}/chats/${encodeURIComponent(chatId)}/messages?${before}${limit}`;
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

    function openLoginPopup() {
      const base = apiAuthBase.value || apiBase.value;
      const popup = window.open(`${base}/auth/microsoft`, 'oauth', 'width=600,height=700');

      // Poll session instead of reading popup DOM (usually cross-origin).
      let tries = 0;
      const timer = setInterval(async () => {
        tries++;
        try {
          const ok = await checkSession();
          if (ok) {
            clearInterval(timer);
            try {
              if (popup && !popup.closed) popup.close();
            } catch (e) {}
            await loadUsersIndex();
            await resolveSelfProfile();
            await loadChats();
            return;
          }
        } catch (e) {}

        try {
          if (!popup || popup.closed) {
            clearInterval(timer);
            await checkSession();
            if (sessionOk.value) {
              await loadChats();
            }
            return;
          }
          const txt = popup.document.body && popup.document.body.innerText;
          if (!txt) return;
          let data;
          try {
            data = JSON.parse(txt);
          } catch (e) {
            return;
          }
          if (data && data.token) {
            token.value = data.token;
            localStorage.setItem('token', token.value);
            popup.close();
            clearInterval(timer);
            await loadUsersIndex();
            await resolveSelfProfile();
            await loadChats();
          }
        } catch (e) {
          // cross-origin until final redirect
        }

        // stop after ~2 minutes
        if (tries > 240) {
          clearInterval(timer);
        }
      }, 500);
    }

    async function logout() {
      token.value = null;
      localStorage.removeItem('token');
      sessionOk.value = false;
      try {
        if (socket.value) socket.value.disconnect();
      } catch (e) {}
      socket.value = null;
      joinedChatId.value = null;
      try {
        const base = apiAuthBase.value || apiBase.value;
        fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
      } catch (e) {}
      window.location.href = '/';
    }

    async function fetchMissingUserNames(ids) {
      const missing = Array.from(ids).filter((id) => id && !userNameCache[id]);
      if (missing.length === 0) return;
      await Promise.allSettled(
        missing.map(async (id) => {
          try {
            const res = await safeFetch(`${apiBase.value}/users/${encodeURIComponent(id)}`);
            if (!res.ok) throw new Error('no user');
            const u = await res.json();
            userNameCache[id] = u.username || u.displayName || id;
            const face = (u && (u.faceUrl || u.face_url || u.face)) || '';
            if (face) userFaceCache[id] = face;
          } catch (e) {
            userNameCache[id] = id;
          }
        })
      );
    }

    function normalizeMessage(m, isGlobal) {
      if (!m || typeof m !== 'object') return m;
      // unify author id
      if (m.from && !m.from_user) m.from_user = m.from;
      // unify reply field
      if (m.repliedTo !== undefined && m.replied_to === undefined) m.replied_to = m.repliedTo;
      // global: backend may use `from`
      if (isGlobal && m.from && !m.from_user) m.from_user = m.from;
      return m;
    }

    function messageAuthorName(m) {
      const id = m && m.from_user;
      if (!id) return '';
      if (isOwnMessage(m)) return '我';
      return userNameCache[id] || id;
    }

    function isOwnMessage(m) {
      if (!m) return false;
      if (m.__own === true) return true;
      if (!m.from_user || !selfUserId.value) return false;
      return String(m.from_user) === String(selfUserId.value);
    }

    function isImageFile(m) {
      const mm = m && m.content && (m.content.mimetype || m.content.type);
      return !!mm && String(mm).startsWith('image/');
    }

    function isVideoFile(m) {
      const mm = m && m.content && (m.content.mimetype || m.content.type);
      return !!mm && String(mm).startsWith('video/');
    }

    function fileDisplayUrl(m) {
      if (!m || !m.content) return '';
      return m.content.__localUrl || m.content.thumbnailUrl || m.content.url || '';
    }

    function bubbleBackground(m) {
      if (!m) return '#fff';
      if (m.__status === 'sending') return '#eef6ff';
      if (m.__status === 'failed') return '#ffecec';
      return '#fff';
    }

    function messageTextPreview(m) {
      if (!m) return '';
      if (m.type === 'emoji' && m.content) {
        return '[表情] ' + (m.content.filename || '');
      }
      if (m.content && typeof m.content === 'object') {
        // content might be {text:...} or other structured payload
        return m.content.text || JSON.stringify(m.content);
      }
      if (m.content === null || m.content === undefined) return '';
      return String(m.content);
    }

    function parseMessageTime(m) {
      if (!m) return null;
      const candidates = [
        m.createdAt,
        m.created_at,
        m.sentAt,
        m.sent_at,
        m.timestamp,
        m.time,
        m.ts,
      ];
      const v = candidates.find((x) => x !== undefined && x !== null && x !== '');
      if (v === undefined) return null;
      // number-like
      if (typeof v === 'number') {
        const ms = v < 1e12 ? v * 1000 : v;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
      }
      const s = String(v);
      if (/^\d+$/.test(s)) {
        const num = Number(s);
        const ms = num < 1e12 ? num * 1000 : num;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    }

    function formatTime(m) {
      const d = parseMessageTime(m);
      if (!d) return '';
      const yyyy = String(d.getFullYear());
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${yyyy}年${MM}月${dd}日 ${hh}:${mm}:${ss}`;
    }

    function repliedRefMessage(m) {
      if (!m || !m.replied_to) return null;
      if (typeof m.replied_to === 'object') return m.replied_to;
      return msgById[m.replied_to] || null;
    }

    function scrollToMessage(messageId) {
      try {
        const el = document.querySelector(`.msg-wrapper[data-id="${messageId}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prevBg = el.style.background;
        const prevShadow = el.style.boxShadow;
        const prevRadius = el.style.borderRadius;

        // Light blue highlight with extra breathing room around the message.
        el.style.borderRadius = '10px';
        el.style.background = '#eef6ff';
        // spread shadow creates "padding" visually without shifting layout
        el.style.boxShadow = '0 0 0 6px rgba(238, 246, 255, 0.95)';
        setTimeout(() => {
          el.style.background = prevBg;
          el.style.boxShadow = prevShadow;
          el.style.borderRadius = prevRadius;
        }, 800);
      } catch (e) {}
    }

    function setReplyTarget(m) {
      if (isGlobalChat.value) return;
      replyTarget.value = m;
    }

    function showCtxMenu(ev, msg) {
      if (isGlobalChat.value) return;
      ctxMenuMsg.value = msg;
      let x = ev.clientX;
      let y = ev.clientY;
      // keep menu within viewport
      const menuWidth = 140;
      const menuHeight = 48;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
      if (x < 10) x = 10;
      if (y < 10) y = 10;
      ctxMenuX.value = x;
      ctxMenuY.value = y;
      ctxMenuVisible.value = true;
    }

    function hideCtxMenu() {
      ctxMenuVisible.value = false;
      ctxMenuMsg.value = null;
    }

    function onMessageContextMenu(ev, msg) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (e) {}
      showCtxMenu(ev, msg);
    }

    function ctxReply() {
      if (!ctxMenuMsg.value) return;
      setReplyTarget(ctxMenuMsg.value);
      hideCtxMenu();
    }

    function clearReplyTarget() {
      replyTarget.value = null;
    }

    const replyPreview = computed(() => {
      if (!replyTarget.value) return '';
      const author = messageAuthorName(replyTarget.value);
      const txt = messageTextPreview(replyTarget.value);
      const shortTxt = txt.length > 200 ? txt.slice(0, 200) + '...' : txt;
      return (author ? author + ': ' : '') + shortTxt;
    });

    async function loadChats() {
      try {
        if (!usersIndexLoaded.value) {
          await loadUsersIndex();
          await resolveSelfProfile();
        }
        const res = await safeFetch(`${apiBase.value}/chats`);
        if (!res.ok) throw new Error('未登录或请求失败');
        chats.value = await res.json();

        // open initial chat
        const params = new URLSearchParams(window.location.search);
        const openId = params.get('open') || (window.location.hash ? window.location.hash.replace(/^#/, '') : null);
        const toOpen = openId || 'global';
        await openChat(toOpen);
      } catch (e) {
        console.error(e);
        ElementPlus.ElMessage.error('加载会话失败，请检查登录状态');
      }
    }

    async function openChat(id) {
      // 立即显示加载动画
      chatLoading.value = true;
      
      // 清除当前会话的未读标记
      if (id && id !== 'global') {
        chatUnreadMap[id] = false;
      }
      
      // 等待下一个tick，确保UI更新
      await nextTick();
      
      // leave previous room
      try {
        if (joinedChatId.value && joinedChatId.value !== id) leaveSocketRoom(joinedChatId.value);
      } catch (e) {}

      currentChatId.value = id;
      emojiPanelVisible.value = false;
      currentChatFaceUrl.value = '';
      if (id === 'global') clearReplyTarget();

      const isGlobal = id === 'global';
      try {
        if (isGlobal) {
          currentChatTitle.value = '全服';
        } else {
          currentChatTitle.value = '';

          // Guess peer user for 1:1 chat and show avatar if available
          try {
            const chatObj = (chats.value || []).find((c) => c && c.id === id);
            let members = chatObj && Array.isArray(chatObj.members) ? chatObj.members : null;
            if (!members || members.length === 0) {
              // some backends may use memberIds
              members = chatObj && Array.isArray(chatObj.memberIds) ? chatObj.memberIds : members;
            }
            if (members && members.length === 2 && selfUserId.value) {
              const otherId = members.map(String).find((mid) => String(mid) !== String(selfUserId.value));
              if (otherId) {
                currentChatFaceUrl.value = getCachedFaceUrl(otherId);
                if (!currentChatTitle.value) currentChatTitle.value = userNameCache[otherId] || otherId;
              }
            }
          } catch (e) {}

          try {
            const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(id)}`);
            if (metaRes.ok) {
              const chatMeta = await metaRes.json();
              currentChatTitle.value = chatMeta.displayName || chatMeta.name || '';

              try {
                const members = Array.isArray(chatMeta.members)
                  ? chatMeta.members
                  : Array.isArray(chatMeta.memberIds)
                    ? chatMeta.memberIds
                    : null;
                if (members && members.length === 2 && selfUserId.value) {
                  const otherId = members.map(String).find((mid) => String(mid) !== String(selfUserId.value));
                  if (otherId) {
                    const face = getCachedFaceUrl(otherId);
                    if (face) currentChatFaceUrl.value = face;
                    if (!currentChatTitle.value) currentChatTitle.value = userNameCache[otherId] || otherId;
                  }
                }
              } catch (e) {}
            }
          } catch (e) {}
        }

        const msgUrl = buildMessagesUrl(id, { limit: PAGE_LIMIT });
        const res = await safeFetch(msgUrl);
        if (!res.ok) throw new Error('加载消息失败');
        let msgs = await res.json();
        // Safety: if backend ignores limit and returns full history, only render latest page.
        if (Array.isArray(msgs) && msgs.length > PAGE_LIMIT) msgs = msgs.slice(-PAGE_LIMIT);

        // reset maps
        messages.value = [];
        for (const k of Object.keys(msgById)) delete msgById[k];

        msgs.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.id) msgById[m.id] = m;
        });

        const userIds = new Set();
        msgs.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.from_user) userIds.add(m.from_user);
          if (!isGlobal && m && m.replied_to) {
            const ref = typeof m.replied_to === 'object' ? m.replied_to : msgById[m.replied_to];
            if (ref && ref.from_user) userIds.add(ref.from_user);
          }
        });
        await fetchMissingUserNames(userIds);

        messages.value = msgs.slice().map((m) => normalizeMessage(m, isGlobal));
        noMoreBefore.value = !Array.isArray(msgs) || msgs.length < PAGE_LIMIT;

        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

        // join room after initial load
        try {
          connectSocket();
          joinSocketRoom(id);
        } catch (e) {}
      } catch (e) {
        console.error(e);
        ElementPlus.ElMessage.error('无法打开会话');
      } finally {
        // 加载完成，隐藏动画
        chatLoading.value = false;
      }
    }

    async function loadMoreMessages() {
      if (!currentChatId.value) return;
      if (loadingMore.value || noMoreBefore.value) return;
      if (!messagesEl.value) return;
      const first = messages.value[0];
      if (!first || !first.id) return;

      loadingMore.value = true;
      const beforeId = first.id;
      const isGlobal = currentChatId.value === 'global';

      try {
        const url = buildMessagesUrl(currentChatId.value, { beforeId, limit: PAGE_LIMIT });

        const prevScrollHeight = messagesEl.value.scrollHeight;
        const prevScrollTop = messagesEl.value.scrollTop;

        const res = await safeFetch(url);
        if (!res.ok) throw new Error('加载更多消息失败');
        const more = await res.json();
        if (!more || more.length === 0) {
          noMoreBefore.value = true;
          return;
        }

        more.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.id) msgById[m.id] = m;
        });

        const moreUserIds = new Set();
        more.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.from_user) moreUserIds.add(m.from_user);
          if (!isGlobal && m && m.replied_to) {
            const ref = typeof m.replied_to === 'object' ? m.replied_to : msgById[m.replied_to];
            if (ref && ref.from_user) moreUserIds.add(ref.from_user);
          }
        });
        await fetchMissingUserNames(moreUserIds);

        messages.value = more.concat(messages.value).map((m) => normalizeMessage(m, isGlobal));

        await nextTick();
        const newScrollHeight = messagesEl.value.scrollHeight;
        messagesEl.value.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;

        if (more.length < PAGE_LIMIT) noMoreBefore.value = true;
      } catch (e) {
        console.error(e);
      } finally {
        loadingMore.value = false;
      }
    }

    function onMessagesScroll() {
      if (!messagesEl.value) return;
      if (messagesEl.value.scrollTop < 80) {
        loadMoreMessages();
      }
    }

    async function sendText() {
      if (!currentChatId.value) return ElementPlus.ElMessage.warning('先选择会话');
      const text = msgInput.value.trim();
      if (!text) return;

      const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const optimisticMsg = {
        id: tempId,
        type: 'text',
        content: { text },
        from_user: selfUserId.value || '__me__',
        createdAt: new Date().toISOString(),
        __own: true,
        __status: 'sending',
      };
      if (!isGlobalChat.value && replyTarget.value) optimisticMsg.replied_to = replyTarget.value;
      msgById[tempId] = optimisticMsg;
      messages.value = messages.value.concat([optimisticMsg]);
      msgInput.value = '';
      await nextTick();
      if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

      try {
        if (isGlobalChat.value) {
          const res = await safeFetch(`${apiBase.value}/global/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text }),
          });
          if (!res.ok) throw new Error('发送失败');
          const serverMsg = await res.json().catch(() => null);
          ackOptimisticMessage(tempId, serverMsg, true);
        } else {
          const payload = { type: 'text', content: text };
          if (replyTarget.value) payload.repliedTo = replyTarget.value.id || replyTarget.value;
          const res = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error('发送失败');
          const serverMsg = await res.json().catch(() => null);
          ackOptimisticMessage(tempId, serverMsg, false);
          clearReplyTarget();
        }
      } catch (e) {
        console.error(e);
        optimisticMsg.__status = 'failed';
        ElementPlus.ElMessage.error('发送消息失败');
      } finally {
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      }
    }

    async function toggleEmojiPanel() {
      if (isGlobalChat.value) return;
      emojiPanelVisible.value = !emojiPanelVisible.value;
      if (!emojiPanelVisible.value) return;

      try {
        const res = await safeFetch(`${apiBase.value}/emoji`);
        if (!res.ok) throw new Error('load emoji failed');
        emojiPacks.value = await res.json();
      } catch (e) {
        console.error(e);
        emojiPacks.value = [];
      }
    }

    async function sendEmoji(pack) {
      if (!currentChatId.value) return ElementPlus.ElMessage.warning('先选择会话');
      if (isGlobalChat.value) return ElementPlus.ElMessage.warning('全服聊天不支持表情包');

      const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const optimisticMsg = {
        id: tempId,
        type: 'emoji',
        content: {
          packId: pack.id,
          url: pack.url,
          filename: (pack.meta && pack.meta.filename) || pack.filename || '',
        },
        from_user: selfUserId.value || '__me__',
        createdAt: new Date().toISOString(),
        __own: true,
        __status: 'sending',
      };
      if (replyTarget.value) optimisticMsg.replied_to = replyTarget.value;
      msgById[tempId] = optimisticMsg;
      messages.value = messages.value.concat([optimisticMsg]);
      emojiPanelVisible.value = false;
      await nextTick();
      if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

      try {
        const payload = {
          type: 'emoji',
          content: {
            packId: pack.id,
            url: pack.url,
            filename: (pack.meta && pack.meta.filename) || pack.filename || '',
          },
        };
        if (replyTarget.value) payload.repliedTo = replyTarget.value.id || replyTarget.value;

        const res = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('发送失败');
        const serverMsg = await res.json().catch(() => null);
        ackOptimisticMessage(tempId, serverMsg, false);
      } catch (e) {
        console.error(e);
        optimisticMsg.__status = 'failed';
        ElementPlus.ElMessage.error('发送表情失败');
      } finally {
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      }
    }

    function openFilePicker() {
      if (isGlobalChat.value) return;
      try {
        const el = fileInputEl.value;
        if (!el) return;
        el.value = '';
        el.click();
      } catch (e) {}
    }

    async function onFileSelected(ev) {
      try {
        const files = ev && ev.target && ev.target.files;
        const file = files && files[0];
        if (!file) return;
        await sendFile(file);
      } finally {
        try {
          if (ev && ev.target) ev.target.value = '';
        } catch (e) {}
      }
    }

    async function sendFile(file) {
      if (!currentChatId.value) return ElementPlus.ElMessage.warning('先选择会话');
      if (isGlobalChat.value) return ElementPlus.ElMessage.warning('全服聊天暂不支持发送文件');

      const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let localUrl = '';
      try {
        localUrl = URL.createObjectURL(file);
      } catch (e) {}

      const optimisticMsg = {
        id: tempId,
        type: 'file',
        content: {
          url: '',
          __localUrl: localUrl,
          filename: file.name,
          mimetype: file.type,
        },
        from_user: selfUserId.value || '__me__',
        createdAt: new Date().toISOString(),
        __own: true,
        __status: 'sending',
      };
      if (replyTarget.value) optimisticMsg.replied_to = replyTarget.value;

      msgById[tempId] = optimisticMsg;
      messages.value = messages.value.concat([optimisticMsg]);
      await nextTick();
      if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('type', 'file');
        if (replyTarget.value) fd.append('repliedTo', replyTarget.value.id || String(replyTarget.value));

        const res = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`, {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) throw new Error('发送失败');
        const serverMsg = await res.json().catch(() => null);
        ackOptimisticMessage(tempId, serverMsg, false);
        clearReplyTarget();
      } catch (e) {
        console.error(e);
        optimisticMsg.__status = 'failed';
        ElementPlus.ElMessage.error('发送文件失败');
      } finally {
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      }
    }

    function onChatClick(c) {
      openChat(c.id);
    }

    function openGlobal() {
      openChat('global');
    }

    function goEmojiManage() {
      window.location.href = '/emoji.html';
    }

    function onNav(key) {
      if (key === 'chat') window.location.href = '/chat.html';
      else if (key === 'players') window.location.href = '/players.html';
      else if (key === 'me') window.location.href = '/me.html';
    }

    onMounted(async () => {
      await fetchConfig();
      await checkSession();
      await loadUsersIndex();
      await resolveSelfProfile();
      if (isLoggedIn.value) {
        connectSocket();
        await loadChats();
      }

      // click outside closes emoji panel / ctx menu
      document.addEventListener('click', (ev) => {
        try {
          // Some environments may fire click after right-click; don't instantly close.
          if (ev && ev.button === 2) return;
          // Ignore modified clicks (e.g. Ctrl+Click on mac)
          if (ev && (ev.ctrlKey || ev.metaKey)) return;
        } catch (e) {}
        emojiPanelVisible.value = false;
        hideCtxMenu();
      });
    });

    return {
      // state
      chats,
      chatUnreadMap,
      currentChatId,
      currentChatTitle,
      currentChatFaceUrl,
      chatLoading,
      selfFaceUrl,
      messages,
      msgInput,
      replyTarget,
      replyPreview,
      emojiPanelVisible,
      emojiPacks,
      fileInputEl,
      messagesEl,
      isGlobalChat,
      isLoggedIn,

      ctxMenuVisible,
      ctxMenuX,
      ctxMenuY,

      // helpers
      messageAuthorName,
      messageAuthorFaceUrl,
      messageTextPreview,
      formatLastMessage,
      hasUnread,
      repliedRefMessage,
      scrollToMessage,
      isOwnMessage,
      bubbleBackground,
      formatTime,
      isImageFile,
      isVideoFile,
      fileDisplayUrl,

      // actions
      openLoginPopup,
      logout,
      onChatClick,
      openGlobal,
      onMessageContextMenu,
      ctxReply,
      setReplyTarget,
      clearReplyTarget,
      onMessagesScroll,
      sendText,
      toggleEmojiPanel,
      sendEmoji,
      openFilePicker,
      onFileSelected,
      goEmojiManage,
      onNav,
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
