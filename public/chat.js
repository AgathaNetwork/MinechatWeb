// Vue 3 + Element Plus chat page
const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);

    const chats = ref([]);
    const chatsLoading = ref(false);
    const chatUnreadMap = reactive({});
    const currentChatId = ref(null);
    const currentChatTitle = ref('');
    const currentChatFaceUrl = ref('');
    const currentChatMeta = ref(null);

    const messages = ref([]);
    const msgById = reactive({});
    const userNameCache = reactive({});
    const userFaceCache = reactive({});

    const selfFaceUrl = ref('');
    const usersIndexLoaded = ref(false);

    // Group management
    const groupManageVisible = ref(false);
    const groupManageLoading = ref(false);
    const groupActionLoading = ref(false);
    const groupOwnerId = ref(null);
    const groupAdmins = ref([]);
    const groupEditName = ref('');
    const inviteSelected = ref([]);
    const adminSelected = ref([]);
    const transferOwnerId = ref('');
    const allUsersList = ref([]);

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

    const imagePreviewVisible = ref(false);
    const imagePreviewUrl = ref('');
    const imagePreviewScale = ref(1);
    const imagePreviewX = ref(0);
    const imagePreviewY = ref(0);
    const imagePreviewDragging = ref(false);
    const imagePreviewMoved = ref(false);

    let imgDragStartX = 0;
    let imgDragStartY = 0;
    let imgDragOriginX = 0;
    let imgDragOriginY = 0;

    const selfUserId = ref(null);

    const fileInputEl = ref(null);

    const messagesEl = ref(null);
    const chatLoading = ref(false);

    const isGlobalChat = computed(() => currentChatId.value === 'global');
    const isLoggedIn = computed(() => !!token.value || !!sessionOk.value);

    const isGroupChat = computed(() => {
      try {
        if (!currentChatMeta.value || typeof currentChatMeta.value !== 'object') return false;
        return String(currentChatMeta.value.type || '').toLowerCase() === 'group';
      } catch (e) {
        return false;
      }
    });

    const groupIsOwner = computed(() => {
      if (!selfUserId.value || !groupOwnerId.value) return false;
      return String(selfUserId.value) === String(groupOwnerId.value);
    });

    const groupIsAdmin = computed(() => {
      if (!selfUserId.value) return false;
      const sid = String(selfUserId.value);
      return (groupAdmins.value || []).map(String).includes(sid);
    });

    const groupCanManage = computed(() => {
      return !!(groupIsOwner.value || groupIsAdmin.value);
    });

    const groupMembers = computed(() => {
      try {
        const m = currentChatMeta.value && (currentChatMeta.value.members || currentChatMeta.value.memberIds);
        const arr = Array.isArray(m) ? m.map(String) : [];
        // stable order: owner first, then others
        const owner = groupOwnerId.value ? String(groupOwnerId.value) : null;
        if (owner && arr.includes(owner)) {
          return [owner].concat(arr.filter((x) => x !== owner));
        }
        return arr;
      } catch (e) {
        return [];
      }
    });

    function userLabel(userId) {
      try {
        const id = userId !== undefined && userId !== null ? String(userId) : '';
        if (!id) return '';
        return userNameCache[id] || id;
      } catch (e) {
        return String(userId || '');
      }
    }

    const inviteOptions = computed(() => {
      const members = new Set((groupMembers.value || []).map(String));
      return (allUsersList.value || [])
        .map((u) => ({
          id: String(u.id),
          label: (u.username || u.displayName || u.name || userNameCache[String(u.id)] || String(u.id)) + ` (${String(u.id)})`,
        }))
        .filter((u) => !members.has(String(u.id)));
    });

    const adminOptions = computed(() => {
      const owner = groupOwnerId.value ? String(groupOwnerId.value) : '';
      const members = new Set((groupMembers.value || []).map(String));
      return (allUsersList.value || [])
        .map((u) => ({
          id: String(u.id),
          label: (u.username || u.displayName || u.name || userNameCache[String(u.id)] || String(u.id)) + ` (${String(u.id)})`,
        }))
        .filter((u) => members.has(String(u.id)) && String(u.id) !== owner);
    });

    const transferOptions = computed(() => {
      const owner = groupOwnerId.value ? String(groupOwnerId.value) : '';
      const members = new Set((groupMembers.value || []).map(String));
      return (allUsersList.value || [])
        .map((u) => ({
          id: String(u.id),
          label: (u.username || u.displayName || u.name || userNameCache[String(u.id)] || String(u.id)) + ` (${String(u.id)})`,
        }))
        .filter((u) => members.has(String(u.id)) && String(u.id) !== owner);
    });

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

    function apiHttpBase() {
      try {
        return String(apiBase.value || '').trim().replace(/\/$/, '');
      } catch (e) {
        return '';
      }
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

        function extractChatFromPayload(payload) {
          try {
            if (!payload) return null;
            if (payload.chat && typeof payload.chat === 'object') return payload.chat;
            if (payload.data && payload.data.chat && typeof payload.data.chat === 'object') return payload.data.chat;
            // Sometimes backend may emit the chat object directly.
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
              // Preserve lastMessage/unread flags if not provided.
              const existing = list[idx] || {};
              const merged = Object.assign({}, existing, c);
              if (existing.lastMessage && !merged.lastMessage) merged.lastMessage = existing.lastMessage;
              list.splice(idx, 1, merged);
            } else {
              list.push(c);
            }
            chats.value = list;
            resortChats();

            // Ensure 1:1 peer profile is available for displayName/avatar.
            try {
              const pid = getChatPeerId(c);
              if (pid) fetchMissingUserNames(new Set([pid]));
            } catch (e3) {}
          } catch (e) {}
        }

        function removeChatFromList(chatId) {
          try {
            const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
            if (!cid) return;
            chats.value = (chats.value || []).filter((c) => c && String(c.id) !== cid);
            try { delete chatUnreadMap[cid]; } catch (e) {}
          } catch (e) {}
        }

        async function refreshCurrentChatMetaIfAffected(chatId) {
          try {
            const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
            if (!cid) return;
            if (!currentChatId.value || String(currentChatId.value) !== cid) return;

            const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(cid)}`);
            if (!metaRes.ok) return;
            const chatMeta = await metaRes.json().catch(() => null);
            if (!chatMeta || typeof chatMeta !== 'object') return;
            currentChatMeta.value = chatMeta;
            currentChatTitle.value = chatMeta.displayName || chatMeta.name || currentChatTitle.value;
            if (String(chatMeta.type || '').toLowerCase() === 'group') {
              currentChatTitle.value = chatMeta.displayName || chatMeta.name || '群聊';
              groupOwnerId.value = chatMeta.created_by !== undefined && chatMeta.created_by !== null ? String(chatMeta.created_by) : groupOwnerId.value;
              try { loadGroupAdmins(cid); } catch (e) {}
            }
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
            const current = currentChatId.value;
            
            // 更新会话列表的最新消息和未读状态
            if (chatId && chatId !== 'global') {
              const chat = (chats.value || []).find(c => c && String(c.id) === String(chatId));
              if (chat) {
                chat.lastMessage = msg;
                const fromUser = msg && (msg.from_user || msg.fromUser || msg.from);
                const isSelfMsg = !!(selfUserId.value && fromUser && String(fromUser) === String(selfUserId.value));
                // 如果不是当前打开的会话，标记为未读
                if (!current || String(chatId) !== String(current)) {
                  if (!isSelfMsg) chatUnreadMap[chatId] = true;
                }

                resortChats();
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

        async function onMessageUpdatedLike(payload) {
          try {
            const { chatId, message } = extractChatIdAndMessageFromUpdate(payload);
            if (!message) return;

            // Update chat list preview if needed.
            if (chatId && chatId !== 'global') {
              const chat = (chats.value || []).find((c) => c && String(c.id) === String(chatId));
              if (chat && chat.lastMessage && chat.lastMessage.id && message.id && String(chat.lastMessage.id) === String(message.id)) {
                chat.lastMessage = message;
              }
            }

            const current = currentChatId.value;
            if (!current) return;
            if (chatId && String(chatId) !== String(current)) return;

            applyMessageUpdate(chatId || current, message);
            await ensureUserCachesForMessages([message], current === 'global');
            await nextTick();
          } catch (e) {}
        }

        s.on('message.recalled', onMessageUpdatedLike);
        s.on('message.updated', onMessageUpdatedLike);

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

        // --- Group/chat lifecycle events (real-time updates) ---
        s.on('chat.created', async (payload) => {
          try {
            const chat = extractChatFromPayload(payload);
            if (chat) upsertChatInList(chat);
            const cid = extractChatIdFromPayload(payload);
            if (cid) {
              // Ensure future room-join works if user opens it later.
              // (Desktop only joins current room; this is best-effort.)
              await refreshCurrentChatMetaIfAffected(cid);
            }
          } catch (e) {}
        });

        s.on('chat.updated', async (payload) => {
          try {
            const chat = extractChatFromPayload(payload);
            if (chat) upsertChatInList(chat);
            const cid = extractChatIdFromPayload(payload);
            if (cid) await refreshCurrentChatMetaIfAffected(cid);
          } catch (e) {}
        });

        s.on('chat.renamed', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            const chat = extractChatFromPayload(payload);
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
            if (cid) await refreshCurrentChatMetaIfAffected(cid);
          } catch (e) {}
        });

        s.on('chat.members.added', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            await refreshCurrentChatMetaIfAffected(cid);
            // Also refresh chat list entry best-effort (members may affect display).
            try {
              const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(cid)}`);
              if (metaRes.ok) {
                const meta = await metaRes.json().catch(() => null);
                if (meta) upsertChatInList(meta);
              }
            } catch (e2) {}
          } catch (e) {}
        });

        s.on('chat.members.removed', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            await refreshCurrentChatMetaIfAffected(cid);
            try {
              const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(cid)}`);
              if (metaRes.ok) {
                const meta = await metaRes.json().catch(() => null);
                if (meta) upsertChatInList(meta);
              }
            } catch (e2) {}
          } catch (e) {}
        });

        s.on('chat.admins.changed', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            if (currentChatId.value && String(currentChatId.value) === String(cid)) {
              if (payload && payload.ownerId !== undefined && payload.ownerId !== null) {
                groupOwnerId.value = String(payload.ownerId);
              }
              if (payload && Array.isArray(payload.admins)) {
                groupAdmins.value = payload.admins.map(String);
              }
            }
          } catch (e) {}
        });

        s.on('chat.owner.changed', async (payload) => {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            if (currentChatId.value && String(currentChatId.value) === String(cid)) {
              const ownerId = payload && (payload.ownerId !== undefined ? payload.ownerId : payload.newOwnerId);
              if (ownerId !== undefined && ownerId !== null) groupOwnerId.value = String(ownerId);
              try { loadGroupAdmins(cid); } catch (e2) {}
            }
          } catch (e) {}
        });

        async function handleChatRemovedEvent(payload, tip) {
          try {
            const cid = extractChatIdFromPayload(payload);
            if (!cid) return;
            removeChatFromList(cid);
            if (currentChatId.value && String(currentChatId.value) === String(cid)) {
              try {
                if (tip) ElementPlus.ElMessage.warning(tip);
              } catch (e2) {}
              await openChat('global');
            }
          } catch (e) {}
        }

        s.on('chat.dissolved', (payload) => handleChatRemovedEvent(payload, '群聊已解散'));
        s.on('chat.deleted', (payload) => handleChatRemovedEvent(payload, '会话已删除'));
        s.on('chat.kicked', (payload) => handleChatRemovedEvent(payload, '你已被移出群聊'));
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

    function previewTagAndSuffixFromMessage(m) {
      try {
        if (!m || typeof m !== 'object') return { tag: '', suffix: '', text: '' };
        if (isRecalledMessage(m)) return { tag: '已撤回', suffix: '', text: '' };

        const t = String(m.type || '').toLowerCase();
        if (t === 'emoji' || t === 'sticker') {
          const fn = m.content && m.content.filename ? String(m.content.filename) : '';
          return { tag: '表情', suffix: fn, text: '' };
        }
        if (t === 'file') {
          const mime = m.content && (m.content.mimetype || m.content.type) ? String(m.content.mimetype || m.content.type) : '';
          const fn = m.content && m.content.filename ? String(m.content.filename) : '';
          const tag = /^image\//i.test(mime) ? '图片' : /^video\//i.test(mime) ? '视频' : '文件';
          return { tag, suffix: fn, text: '' };
        }

        const txt = messageTextPreview(m);
        const str = txt ? String(txt) : '';
        return { tag: '', suffix: '', text: str };
      } catch (e) {
        return { tag: '', suffix: '', text: '' };
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

    function messagePreviewTag(m) {
      try {
        return previewTagAndSuffixFromMessage(m).tag || '';
      } catch (e) {
        return '';
      }
    }

    function messagePreviewSuffix(m) {
      try {
        return previewTagAndSuffixFromMessage(m).suffix || '';
      } catch (e) {
        return '';
      }
    }

    function messagePreviewText(m) {
      try {
        const p = previewTagAndSuffixFromMessage(m);
        if (p.tag) return '';
        const s = p.text ? String(p.text) : '';
        return s.length > 60 ? s.slice(0, 60) + '...' : s;
      } catch (e) {
        return '';
      }
    }

    function hasUnread(chatId) {
      return !!chatUnreadMap[chatId];
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

    function chatLastActivityMs(chat) {
      try {
        if (!chat || typeof chat !== 'object') return 0;
        const lm = chat.lastMessage;
        const d = parseMessageTime(lm);
        if (d) return d.getTime();
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
          const face = u.faceUrl || u.face_url || u.face || u.face_key || '';
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
            const face = me.faceUrl || me.face_url || me.face || me.face_key;
            if (face) {
              selfFaceUrl.value = String(face);
              if (selfUserId.value) userFaceCache[String(selfUserId.value)] = String(face);
            }
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

    async function loadAllUsersList() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const list = await res.json().catch(() => null);
        if (!Array.isArray(list)) return;
        allUsersList.value = list
          .filter((u) => u && typeof u === 'object' && (u.id !== undefined && u.id !== null))
          .map((u) => ({
            id: String(u.id),
            username: u.username || u.displayName || u.name || String(u.id),
          }));
      } catch (e) {}
    }

    async function refreshGroupInfo(chatId) {
      if (!chatId) return;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(chatId)}`);
        if (!res.ok) return;
        const meta = await res.json().catch(() => null);
        if (meta && typeof meta === 'object') {
          currentChatMeta.value = meta;
          if (String(meta.type || '').toLowerCase() === 'group') {
            currentChatTitle.value = meta.displayName || meta.name || '群聊';
          }
          // Update chat list entry in-place
          try {
            const idx = (chats.value || []).findIndex((c) => c && String(c.id) === String(chatId));
            if (idx >= 0) {
              const prev = chats.value[idx];
              const next = Object.assign({}, prev, meta);
              chats.value.splice(idx, 1, next);
            }
          } catch (e2) {}
        }
      } catch (e) {}
    }

    async function loadGroupAdmins(chatId) {
      if (!chatId) return;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(chatId)}/admins`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!data || typeof data !== 'object') return;
        groupOwnerId.value = data.ownerId !== undefined && data.ownerId !== null ? String(data.ownerId) : groupOwnerId.value;
        groupAdmins.value = Array.isArray(data.admins) ? data.admins.map(String) : [];
      } catch (e) {}
    }

    async function openGroupManage() {
      if (!isGroupChat.value || !currentChatId.value || currentChatId.value === 'global') return;
      groupManageVisible.value = true;
      groupManageLoading.value = true;
      inviteSelected.value = [];
      transferOwnerId.value = '';
      try {
        await Promise.all([refreshGroupInfo(currentChatId.value), loadGroupAdmins(currentChatId.value), loadAllUsersList()]);
        const meta = currentChatMeta.value;
        groupEditName.value = (meta && (meta.name || meta.displayName)) ? String(meta.name || meta.displayName) : '';
        adminSelected.value = (groupAdmins.value || []).map(String);
      } finally {
        groupManageLoading.value = false;
      }
    }

    async function saveGroupName() {
      if (!groupCanManage.value) return;
      if (!currentChatId.value) return;
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: (groupEditName.value || '').trim() || null }),
        });
        if (!res.ok) throw new Error('save name failed');
        const updated = await res.json().catch(() => null);
        if (updated && typeof updated === 'object') {
          currentChatMeta.value = updated;
          currentChatTitle.value = updated.displayName || updated.name || '群聊';
          try {
            const idx = (chats.value || []).findIndex((c) => c && String(c.id) === String(currentChatId.value));
            if (idx >= 0) chats.value.splice(idx, 1, Object.assign({}, chats.value[idx], updated));
          } catch (e2) {}
          ElementPlus.ElMessage.success('已保存');
        }
      } catch (e) {
        ElementPlus.ElMessage.error('保存失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function inviteToGroup() {
      if (!groupCanManage.value) return;
      if (!currentChatId.value) return;
      const ids = (inviteSelected.value || []).map(String).filter(Boolean);
      if (ids.length === 0) return;
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: ids }),
        });
        if (!res.ok) throw new Error('invite failed');
        inviteSelected.value = [];
        await Promise.all([refreshGroupInfo(currentChatId.value), loadGroupAdmins(currentChatId.value)]);
        ElementPlus.ElMessage.success('已邀请');
      } catch (e) {
        ElementPlus.ElMessage.error('邀请失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function kickFromGroup(userId) {
      if (!groupCanManage.value) return;
      if (!currentChatId.value) return;
      const uid = userId !== undefined && userId !== null ? String(userId) : '';
      if (!uid) return;
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/kick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: [uid] }),
        });
        if (!res.ok) throw new Error('kick failed');
        await Promise.all([refreshGroupInfo(currentChatId.value), loadGroupAdmins(currentChatId.value)]);
        ElementPlus.ElMessage.success('已移除');
      } catch (e) {
        ElementPlus.ElMessage.error('移除失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function saveGroupAdmins() {
      if (!groupIsOwner.value) return;
      if (!currentChatId.value) return;
      const ids = (adminSelected.value || []).map(String).filter(Boolean);
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/admins`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admins: ids }),
        });
        if (!res.ok) throw new Error('save admins failed');
        const data = await res.json().catch(() => null);
        groupOwnerId.value = data && data.ownerId ? String(data.ownerId) : groupOwnerId.value;
        groupAdmins.value = data && Array.isArray(data.admins) ? data.admins.map(String) : groupAdmins.value;
        ElementPlus.ElMessage.success('已保存');
      } catch (e) {
        ElementPlus.ElMessage.error('保存失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function transferGroupOwner() {
      if (!groupIsOwner.value) return;
      if (!currentChatId.value) return;
      const nid = transferOwnerId.value ? String(transferOwnerId.value) : '';
      if (!nid) return;
      groupActionLoading.value = true;
      try {
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(currentChatId.value)}/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newOwnerId: nid }),
        });
        if (!res.ok) throw new Error('transfer failed');
        transferOwnerId.value = '';
        await Promise.all([refreshGroupInfo(currentChatId.value), loadGroupAdmins(currentChatId.value)]);
        ElementPlus.ElMessage.success('已转让');
      } catch (e) {
        ElementPlus.ElMessage.error('转让失败');
      } finally {
        groupActionLoading.value = false;
      }
    }

    async function dissolveGroupChat() {
      if (!groupIsOwner.value) return;
      if (!currentChatId.value || currentChatId.value === 'global') return;
      if (groupActionLoading.value) return;

      try {
        await ElementPlus.ElMessageBox.confirm(
          '确定解散该群聊吗？解散后将删除该群聊及其消息记录。',
          '解散群聊',
          {
            type: 'warning',
            confirmButtonText: '解散',
            cancelButtonText: '取消',
            distinguishCancelAndClose: true,
          }
        );
      } catch (e) {
        return;
      }

      groupActionLoading.value = true;
      try {
        const chatId = String(currentChatId.value);
        const res = await safeFetch(`${apiHttpBase()}/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
        if (!res.ok) {
          let err = '';
          try {
            const data = await res.json().catch(() => null);
            err = data && (data.error || data.message) ? String(data.error || data.message) : '';
          } catch (e2) {}
          if (!err) err = `解散失败 (${res.status})`;
          throw new Error(err);
        }

        try {
          chats.value = (chats.value || []).filter((c) => c && String(c.id) !== String(chatId));
          try { delete chatUnreadMap[String(chatId)]; } catch (e3) {}
        } catch (e4) {}

        groupManageVisible.value = false;
        ElementPlus.ElMessage.success('群聊已解散');
        await openChat('global');
      } catch (e) {
        const msg = e && e.message ? String(e.message) : '解散失败';
        ElementPlus.ElMessage.error(msg);
      } finally {
        groupActionLoading.value = false;
      }
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
      try {
        if (!chat) return '';
        return chat.displayName || chat.name || (chat.members || []).join(',') || String(chat.id || '');
      } catch (e) {
        return '';
      }
    }

    function getChatInitial(chat) {
      const name = String(getChatName(chat) || '').trim();
      if (!name) return '?';
      return name.charAt(0).toUpperCase();
    }

    function getChatAvatar(chat) {
      const peerId = getChatPeerId(chat);
      if (!peerId) return '';
      if (selfUserId.value && String(peerId) === String(selfUserId.value)) {
        return selfFaceUrl.value || getCachedFaceUrl(peerId);
      }
      return getCachedFaceUrl(peerId);
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
      if (isRecalledMessage(m)) return '#f7f7f7';
      if (m.__status === 'sending') return '#eef6ff';
      if (m.__status === 'failed') return '#ffecec';
      return '#fff';
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

    function recallNoticeText(m) {
      try {
        if (!m) return '消息已撤回';
        if (isOwnMessage(m)) return '你撤回了一条消息';
        const name = messageAuthorName(m) || '对方';
        return `${name}撤回了一条消息`;
      } catch (e) {
        return '消息已撤回';
      }
    }

    function previewFromStructuredContent(content) {
      try {
        if (!content || typeof content !== 'object') return '';

        // Most common: { text: "..." }
        if (content.text !== undefined && content.text !== null) {
          const t = String(content.text);
          return t;
        }

        // Emoji-like payloads
        if (content.packId || content.pack_id) return '[表情]';

        // Some backends may wrap images as { key: "image/..." }
        if (content.key && /^image\//i.test(String(content.key))) return '[表情]';

        // File/image-like payloads
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

    function messageTextPreview(m) {
      if (!m) return '';
      if (isRecalledMessage(m)) return '[消息已撤回]';
      if (m.type === 'emoji' && m.content) {
        const fn = (m.content && m.content.filename) ? String(m.content.filename) : '';
        return fn ? '[表情] ' + fn : '[表情]';
      }
      if (m.type === 'file') {
        const fn = m.content && m.content.filename ? String(m.content.filename) : '';
        return fn ? '[文件] ' + fn : '[文件]';
      }
      if (m.content && typeof m.content === 'object') {
        // content might be {text:...} or other structured payload
        return previewFromStructuredContent(m.content);
      }
      if (m.content === null || m.content === undefined) return '';
      return String(m.content);
    }

    function canRecallMessage(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (isGlobalChat.value) return false;
        if (!isOwnMessage(m)) return false;
        if (isRecalledMessage(m)) return false;
        if (!m.id) return false;
        const id = String(m.id);
        if (id.startsWith('local-') || id.startsWith('temp_')) return false;
        if (m.__status === 'sending') return false;

        const d = parseMessageTime(m);
        if (!d) return false;
        const age = Date.now() - d.getTime();
        return age >= 0 && age <= 2 * 60 * 1000;
      } catch (e) {
        return false;
      }
    }

    function extractChatIdAndMessageFromUpdate(payload) {
      try {
        if (!payload) return { chatId: null, message: null };
        if (payload.message && typeof payload.message === 'object') {
          const chatId = payload.chatId || payload.chat_id || normalizeChatIdFromMessage(payload.message) || null;
          return { chatId, message: payload.message };
        }
        const chatId = normalizeChatIdFromMessage(payload) || payload.chatId || payload.chat_id || null;
        return { chatId, message: payload };
      } catch (e) {
        return { chatId: null, message: null };
      }
    }

    function applyMessageUpdate(chatId, updated) {
      try {
        if (!updated || typeof updated !== 'object') return;
        const id = updated.id;
        if (!id) return;

        // normalize fields so UI can render
        normalizeMessage(updated, chatId === 'global');

        if (msgById[id]) {
          try {
            Object.assign(msgById[id], updated);
          } catch (e) {}
        } else if (currentChatId.value && chatId && String(chatId) === String(currentChatId.value)) {
          upsertIncomingMessage(updated);
        }

        // If this is the last message of a chat in list, update preview.
        if (chatId && chatId !== 'global') {
          const chat = (chats.value || []).find((c) => c && String(c.id) === String(chatId));
          if (chat && chat.lastMessage && chat.lastMessage.id && String(chat.lastMessage.id) === String(id)) {
            chat.lastMessage = updated;
          }
        }
      } catch (e) {}
    }

    async function postRecallRequest(messageId) {
      const mid = messageId !== undefined && messageId !== null ? String(messageId) : '';
      if (!mid) throw new Error('missing messageId');

      const endpoints = [];
      // Common patterns across different backends / router mounts.
      endpoints.push(`${apiBase.value}/messages/${encodeURIComponent(mid)}/recall`);
      if (currentChatId.value) {
        endpoints.push(`${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages/${encodeURIComponent(mid)}/recall`);
      }
      endpoints.push(`${apiBase.value}/chats/${encodeURIComponent(mid)}/recall`);

      let lastErr = null;
      for (const url of endpoints) {
        try {
          const res = await safeFetch(url, { method: 'POST' });
          if (res.ok) return await res.json().catch(() => ({}));
          if (res.status === 404) continue;

          let err = '';
          try {
            const data = await res.json().catch(() => null);
            err = data && (data.error || data.message) ? String(data.error || data.message) : '';
          } catch (e) {}
          if (!err) err = `撤回失败 (${res.status})`;
          lastErr = new Error(err);
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('撤回失败');
    }

    async function ctxRecall() {
      const msg = ctxMenuMsg.value;
      hideCtxMenu();
      try {
        if (!canRecallMessage(msg)) {
          ElementPlus.ElMessage.warning('只能撤回 2 分钟内发送的消息');
          return;
        }
        const result = await postRecallRequest(msg.id);
        const updated = (result && result.message) ? result.message : null;
        if (updated) {
          applyMessageUpdate(updated.chatId || updated.chat_id || currentChatId.value, updated);
        }
      } catch (e) {
        const m = e && e.message ? String(e.message) : '撤回失败';
        ElementPlus.ElMessage.error(m);
      }
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

    function shouldShowTimeDivider(idx) {
      try {
        const gapMs = 5 * 60 * 1000;
        const list = Array.isArray(messages.value) ? messages.value : [];
        if (idx === undefined || idx === null) return false;
        const i = Number(idx);
        if (!Number.isFinite(i) || i <= 0) return false;
        const prev = list[i - 1];
        const cur = list[i];
        const prevD = parseMessageTime(prev);
        const curD = parseMessageTime(cur);
        if (!prevD || !curD) return false;
        const diff = curD.getTime() - prevD.getTime();
        return diff > gapMs;
      } catch (e) {
        return false;
      }
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

    function openImagePreview(url) {
      try {
        const u = String(url || '').trim();
        if (!u) return;
        imagePreviewUrl.value = u;
        imagePreviewVisible.value = true;
        imagePreviewScale.value = 1;
        imagePreviewX.value = 0;
        imagePreviewY.value = 0;
        imagePreviewDragging.value = false;
        imagePreviewMoved.value = false;
      } catch (e) {}
    }

    function closeImagePreview() {
      try {
        imagePreviewVisible.value = false;
        imagePreviewUrl.value = '';
        imagePreviewScale.value = 1;
        imagePreviewX.value = 0;
        imagePreviewY.value = 0;
        imagePreviewDragging.value = false;
        imagePreviewMoved.value = false;
      } catch (e) {}
    }

    function requestCloseImagePreview() {
      try {
        if (imagePreviewDragging.value) return;
        if (imagePreviewMoved.value) {
          imagePreviewMoved.value = false;
          return;
        }
        closeImagePreview();
      } catch (e) {}
    }

    function clampImageScale(s) {
      const v = Number(s);
      if (!Number.isFinite(v)) return 1;
      return Math.min(5, Math.max(1, v));
    }

    function resetImagePreviewTransform() {
      imagePreviewScale.value = 1;
      imagePreviewX.value = 0;
      imagePreviewY.value = 0;
      imagePreviewDragging.value = false;
      imagePreviewMoved.value = false;
    }

    const imagePreviewStyle = computed(() => {
      const x = Number(imagePreviewX.value) || 0;
      const y = Number(imagePreviewY.value) || 0;
      const s = Number(imagePreviewScale.value) || 1;
      return {
        transform: `translate(${x}px, ${y}px) scale(${s})`,
      };
    });

    function onImagePreviewToggle() {
      try {
        closeImagePreview();
      } catch (e) {}
    }

    function onImagePreviewWheel(ev) {
      try {
        if (!ev) return;
        const target = ev.currentTarget || ev.target;
        if (!target || !target.getBoundingClientRect) return;

        const rect = target.getBoundingClientRect();
        const cx = Number(ev.clientX) || 0;
        const cy = Number(ev.clientY) || 0;

        const oldScale = Number(imagePreviewScale.value) || 1;
        const delta = ev.deltaY;
        const factor = delta < 0 ? 1.1 : 0.9;
        const newScale = clampImageScale(oldScale * factor);
        if (newScale === oldScale) return;

        // With transform-origin: 0 0 and transform: translate(x,y) scale(s)
        // rect.left/top corresponds to the transformed origin (L0 + x, T0 + y).
        const px = cx - rect.left;
        const py = cy - rect.top;

        const curX = Number(imagePreviewX.value) || 0;
        const curY = Number(imagePreviewY.value) || 0;
        imagePreviewX.value = curX + px * (1 - newScale / oldScale);
        imagePreviewY.value = curY + py * (1 - newScale / oldScale);
        imagePreviewScale.value = newScale;

        if (newScale === 1) {
          imagePreviewX.value = 0;
          imagePreviewY.value = 0;
        }
      } catch (e) {}
    }

    function onImagePreviewMouseDown(ev) {
      try {
        if (!ev) return;
        imagePreviewDragging.value = true;
        imgDragStartX = ev.clientX;
        imgDragStartY = ev.clientY;
        imgDragOriginX = Number(imagePreviewX.value) || 0;
        imgDragOriginY = Number(imagePreviewY.value) || 0;
      } catch (e) {}
    }

    function onImagePreviewMouseMove(ev) {
      try {
        if (!imagePreviewDragging.value) return;
        if (!ev) return;
        const dx = ev.clientX - imgDragStartX;
        const dy = ev.clientY - imgDragStartY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) imagePreviewMoved.value = true;
        imagePreviewX.value = imgDragOriginX + dx;
        imagePreviewY.value = imgDragOriginY + dy;
      } catch (e) {}
    }

    function onImagePreviewMouseUp() {
      try {
        imagePreviewDragging.value = false;
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
      const menuHeight = 140;
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

    function canCollectEmoji(m) {
      try {
        if (!m || typeof m !== 'object') return false;
        if (!m.id) return false;
        const t = String(m.type || '').toLowerCase();
        return t === 'emoji' || t === 'sticker';
      } catch (e) {
        return false;
      }
    }

    async function ctxCollectEmoji() {
      const msg = ctxMenuMsg.value;
      if (!canCollectEmoji(msg)) return;
      hideCtxMenu();
      try {
        const res = await safeFetch(`${apiBase.value}/emoji/collect/${encodeURIComponent(msg.id)}`, {
          method: 'POST',
        });
        if (res.ok) {
          ElementPlus.ElMessage.success('已添加到表情包');
          if (emojiPanelVisible.value) {
            try {
              const r = await safeFetch(`${apiBase.value}/emoji`);
              if (r.ok) emojiPacks.value = await r.json();
            } catch (e2) {}
          }
          return;
        }

        let err = '';
        try {
          const data = await res.json().catch(() => null);
          err = data && (data.error || data.message) ? String(data.error || data.message) : '';
        } catch (e) {}
        if (!err) err = `操作失败 (${res.status})`;
        if (res.status === 400) ElementPlus.ElMessage.warning(err);
        else ElementPlus.ElMessage.error(err);
      } catch (e) {
        ElementPlus.ElMessage.error('添加失败');
      }
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
      chatsLoading.value = true;
      try {
        if (!usersIndexLoaded.value) {
          await loadUsersIndex();
          await resolveSelfProfile();
        }
        const res = await safeFetch(`${apiBase.value}/chats`);
        if (!res.ok) throw new Error('未登录或请求失败');
        chats.value = sortChatsList(await res.json());

        // If we were asked to open a specific chat, but it doesn't appear in the list yet
        // (race condition / cached list / eventual consistency), fetch it best-effort and insert.
        try {
          const params = new URLSearchParams(window.location.search);
          const openId = params.get('open') || (window.location.hash ? window.location.hash.replace(/^#/, '') : null);
          const toOpen = openId || null;
          if (toOpen && toOpen !== 'global') {
            const exists = (chats.value || []).some((c) => c && String(c.id) === String(toOpen));
            if (!exists) {
              const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(toOpen)}`);
              if (metaRes.ok) {
                const meta = await metaRes.json().catch(() => null);
                if (meta && typeof meta === 'object') {
                  chats.value = sortChatsList((chats.value || []).concat([meta]));
                }
              }
            }
          }
        } catch (e) {}

        // Prefetch 1:1 peer profiles so chat list can show avatars.
        try {
          const peerIds = new Set();
          (chats.value || []).forEach((c) => {
            const pid = getChatPeerId(c);
            if (pid) peerIds.add(pid);
          });
          await fetchMissingUserNames(peerIds);
        } catch (e) {}

        // open initial chat
        const params = new URLSearchParams(window.location.search);
        const openId = params.get('open') || (window.location.hash ? window.location.hash.replace(/^#/, '') : null);
        const toOpen = openId || 'global';
        await openChat(toOpen);
      } catch (e) {
        console.error(e);
        ElementPlus.ElMessage.error('加载会话失败，请检查登录状态');
      } finally {
        chatsLoading.value = false;
      }
    }

    async function openChat(id) {
      // 立即显示加载动画
      chatLoading.value = true;

      // Reset paging UI state
      loadingMore.value = false;
      noMoreBefore.value = false;
      
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
      currentChatMeta.value = null;
      emojiPanelVisible.value = false;
      currentChatFaceUrl.value = '';
      if (id === 'global') clearReplyTarget();

      const isGlobal = id === 'global';
      try {
        if (isGlobal) {
          currentChatTitle.value = '全服';
          currentChatFaceUrl.value = '/img/Ag_0404.png';
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
              currentChatMeta.value = chatMeta;
              currentChatTitle.value = chatMeta.displayName || chatMeta.name || '';

              if (String(chatMeta.type || '').toLowerCase() === 'group') {
                currentChatTitle.value = chatMeta.displayName || chatMeta.name || '群聊';
                groupOwnerId.value = chatMeta.created_by !== undefined && chatMeta.created_by !== null ? String(chatMeta.created_by) : groupOwnerId.value;
                // best-effort load admins async
                try { loadGroupAdmins(id); } catch (e) {}
              }

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

      // Image preview drag handlers
      try {
        window.addEventListener('mousemove', onImagePreviewMouseMove);
        window.addEventListener('mouseup', onImagePreviewMouseUp);
      } catch (e) {}

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
      chatsLoading,
      chatUnreadMap,
      currentChatId,
      currentChatTitle,
      currentChatFaceUrl,
      chatLoading,
      loadingMore,
      selfFaceUrl,
      messages,
      msgInput,
      imagePreviewVisible,
      imagePreviewUrl,
      imagePreviewDragging,
      imagePreviewStyle,
      replyTarget,
      replyPreview,
      emojiPanelVisible,
      emojiPacks,
      fileInputEl,
      messagesEl,
      isGlobalChat,
      isLoggedIn,
      isGroupChat,

      ctxMenuVisible,
      ctxMenuX,
      ctxMenuY,
      ctxMenuMsg,

      // helpers
      messageAuthorName,
      messageAuthorFaceUrl,
      messageTextPreview,
      isRecalledMessage,
      recallNoticeText,
      formatLastMessage,
      lastMessagePreviewTag,
      lastMessagePreviewSuffix,
      messagePreviewTag,
      messagePreviewSuffix,
      messagePreviewText,
      getChatName,
      getChatAvatar,
      getChatInitial,
      hasUnread,
      repliedRefMessage,
      scrollToMessage,
      isOwnMessage,
      bubbleBackground,
      formatTime,
      shouldShowTimeDivider,
      isImageFile,
      isVideoFile,
      fileDisplayUrl,
      openImagePreview,
      closeImagePreview,
      requestCloseImagePreview,
      onImagePreviewToggle,
      onImagePreviewWheel,
      onImagePreviewMouseDown,

      // group management
      groupManageVisible,
      groupManageLoading,
      groupActionLoading,
      groupOwnerId,
      groupAdmins,
      groupEditName,
      inviteSelected,
      adminSelected,
      transferOwnerId,
      groupMembers,
      groupIsOwner,
      groupCanManage,
      inviteOptions,
      adminOptions,
      transferOptions,
      userLabel,
      openGroupManage,
      saveGroupName,
      inviteToGroup,
      kickFromGroup,
      saveGroupAdmins,
      transferGroupOwner,
      dissolveGroupChat,

      // actions
      openLoginPopup,
      logout,
      onChatClick,
      openGlobal,
      onMessageContextMenu,
      ctxReply,
      canRecallMessage,
      ctxRecall,
      canCollectEmoji,
      ctxCollectEmoji,
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
