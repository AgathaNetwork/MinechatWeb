// Mobile chat detail page - simplified version
const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const currentChatId = ref(null);
    const currentChatTitle = ref('');
    const currentChatFaceUrl = ref('');
    const messages = ref([]);
    const msgById = reactive({});
    const userNameCache = reactive({});
    const userFaceCache = reactive({});
    const selfUserId = ref(null);

    const fileInputEl = ref(null);
    const inputAreaEl = ref(null);

    const msgInput = ref('');
    const imagePreviewVisible = ref(false);
    const imagePreviewUrl = ref('');
    const imagePreviewScale = ref(1);
    const imagePreviewX = ref(0);
    const imagePreviewY = ref(0);
    const imagePreviewMoved = ref(false);

    let imgDragActive = false;
    let imgDragStartX = 0;
    let imgDragStartY = 0;
    let imgDragOriginX = 0;
    let imgDragOriginY = 0;

    let imgPinchActive = false;
    let imgPinchStartDist = 0;
    let imgPinchStartScale = 1;
    let imgPinchStartCenterX = 0;
    let imgPinchStartCenterY = 0;
    let imgPinchOriginX = 0;
    let imgPinchOriginY = 0;
    let imgPinchLastCenterX = 0;
    let imgPinchLastCenterY = 0;

    let imgTapCandidate = false;
    let imgTapStartX = 0;
    let imgTapStartY = 0;

    let maskTapCandidate = false;
    let maskTapStartX = 0;
    let maskTapStartY = 0;
    const messagesEl = ref(null);
    const chatLoading = ref(false);

    const loadingMore = ref(false);
    const noMoreBefore = ref(false);
    const PAGE_LIMIT = 20;
    const INITIAL_LIMIT = 50;
    const isGlobalChat = computed(() => currentChatId.value === 'global');
    const socket = ref(null);
    const joinedChatId = ref(null);
    const replyTarget = ref(null);
    const emojiPanelVisible = ref(false);
    const emojiPacks = ref([]);
    const longPressTimer = ref(null);
    const longPressTarget = ref(null);
    const ctxMenuVisible = ref(false);
    const ctxMenuX = ref(0);
    const ctxMenuY = ref(0);
    const ctxMenuMsg = ref(null);

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
        const base = String(apiBase.value || '').replace(/\/$/, '');
        if (base && base !== '/') return base + '/' + u;
        return u;
      } catch (e) {
        return '';
      }
    }

    const replyPreview = computed(() => {
      if (!replyTarget.value) return '';
      const tag = messagePreviewTag(replyTarget.value);
      if (tag) {
        const suffix = messagePreviewSuffix(replyTarget.value);
        return suffix ? `${tag} ${suffix}` : tag;
      }
      return messagePreviewText(replyTarget.value) || '消息';
    });

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

    function buildMessagesUrl(chatId, opts) {
      const before = opts && opts.beforeId ? `before=${encodeURIComponent(opts.beforeId)}&` : '';
      const lim = opts && opts.limit ? opts.limit : PAGE_LIMIT;
      const limit = `limit=${encodeURIComponent(lim)}`;
      if (chatId === 'global') return `${apiBase.value}/global/messages?${before}${limit}`;
      return `${apiBase.value}/chats/${encodeURIComponent(chatId)}/messages?${before}${limit}`;
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

    function getCachedFaceUrl(userId) {
      if (!userId) return '';
      return userFaceCache[String(userId)] || '';
    }

    async function loadUsersIndex() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const users = await res.json();
        users.forEach(u => {
          const id = String(u.id);
          userNameCache[id] = u.username || u.id;
          const face = normalizeFaceUrl(u.faceUrl || u.face_url || u.face || '');
          if (face) userFaceCache[id] = face;
        });
      } catch (e) {}
    }

    function decodeJwtPayload(jwt) {
      try {
        const parts = String(jwt || '').split('.');
        if (parts.length < 2) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
        const json = decodeURIComponent(
          atob(base64 + pad)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    }

    async function resolveSelfUserId() {
      // 1) Prefer extracting from JWT token (no network)
      if (token.value) {
        const payload = decodeJwtPayload(token.value);
        if (payload && typeof payload === 'object') {
          const candidate = payload.userId || payload.uid || payload.id || payload.sub;
          if (candidate !== undefined && candidate !== null && String(candidate) !== '') {
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
          const candidate =
            data.userId ||
            data.uid ||
            data.id ||
            (data.user && (data.user.id || data.user.userId));
          if (candidate !== undefined && candidate !== null && String(candidate) !== '') {
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

    async function resolveSelfProfile() {
      // Best-effort: try /users/me first (matches desktop)
      try {
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if (res.ok) {
          const me = await res.json().catch(() => null);
          if (me && typeof me === 'object') {
            const id = me.id || me.userId || me.uid;
            if (id !== undefined && id !== null) selfUserId.value = String(id);
            const name = me.username || me.displayName;
            if (name && selfUserId.value) userNameCache[selfUserId.value] = String(name);
            const face = normalizeFaceUrl(me.faceUrl || me.face_url || me.face || '');
            if (face && selfUserId.value) userFaceCache[selfUserId.value] = String(face);
            return;
          }
        }
      } catch (e) {}

      await resolveSelfUserId();
    }

    function normalizeMessage(m, isGlobal) {
      if (!m) return m;
      if (!m.id) m.id = String(Math.random());
      if (!m.type) m.type = 'text';
      // unify author id (desktop behavior)
      if (m.from && !m.from_user) m.from_user = m.from;
      if (m.from_user === undefined && m.fromUser) m.from_user = m.fromUser;
      // unify reply field (desktop behavior)
      if (m.repliedTo !== undefined && m.replied_to === undefined) m.replied_to = m.repliedTo;
      if (m.created_at === undefined && m.createdAt) m.created_at = m.createdAt;
      return m;
    }

    function messageAuthorName(m) {
      if (!m) return '';
      const from = m.from_user || m.fromUser || m.from;
      if (!from) return '';
      if (String(from) === String(selfUserId.value)) return '我';
      return userNameCache[String(from)] || from;
    }

    function messageAuthorFaceUrl(m) {
      if (!m || isOwnMessage(m)) return '';
      const from = m.from_user || m.fromUser || m.from;
      return from ? getCachedFaceUrl(from) : '';
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

    function messageTextPreview(m) {
      if (!m) return '';
      if (isRecalledMessage(m)) return '[消息已撤回]';
      if (m.type === 'text') {
        const t = (m.content && (m.content.text !== undefined ? m.content.text : m.content)) || '';
        return String(t);
      }
      return '';
    }

    function truncatePreviewText(s, maxLen) {
      try {
        const max = maxLen || 120;
        const str = String(s || '');
        if (!str) return '';
        return str.length > max ? str.slice(0, max) + '…' : str;
      } catch (e) {
        return '';
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
        if (!m || typeof m !== 'object') return '';
        if (isRecalledMessage(m)) return '';
        if (String(m.type || '') === 'text') {
          const t = (m.content && (m.content.text !== undefined ? m.content.text : m.content)) || '';
          return truncatePreviewText(String(t), 120);
        }
        return '';
      } catch (e) {
        return '';
      }
    }

    function isOwnMessage(m) {
      if (!m || !selfUserId.value) return false;
      const from = m.from_user || m.fromUser || m.from || m.author;
      if (m.__own) return true;
      return String(from) === String(selfUserId.value);
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
        el.style.borderRadius = '10px';
        el.style.background = '#eef6ff';
        el.style.boxShadow = '0 0 0 6px rgba(238, 246, 255, 0.95)';
        setTimeout(() => {
          el.style.background = prevBg;
          el.style.boxShadow = prevShadow;
          el.style.borderRadius = prevRadius;
        }, 800);
      } catch (e) {}
    }

    function isImageFile(m) {
      if (!m || m.type !== 'file' || !m.content) return false;
      const mime = m.content.mimetype || m.content.type || '';
      return /^image\//i.test(mime);
    }

    function isVideoFile(m) {
      if (!m || m.type !== 'file' || !m.content) return false;
      const mime = m.content.mimetype || m.content.type || '';
      return /^video\//i.test(mime);
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

    function removeMessageById(messageId) {
      if (!messageId) return;
      if (msgById[messageId]) delete msgById[messageId];
      messages.value = (messages.value || []).filter((m) => m && m.id !== messageId);
    }

    function contentSignature(m) {
      try {
        if (!m) return '';
        const t = m.type || 'text';
        if (t === 'text') {
          const txt = (m.content && (m.content.text !== undefined ? m.content.text : m.content)) || '';
          return 'text:' + String(txt);
        }
        if (t === 'emoji') {
          const pid = (m.content && (m.content.packId || m.content.pack_id)) || '';
          const url = (m.content && m.content.url) || '';
          return 'emoji:' + String(pid) + ':' + String(url);
        }
        if (t === 'file') {
          const fn = (m.content && m.content.filename) || '';
          const mm = (m.content && (m.content.mimetype || m.content.type)) || '';
          return 'file:' + String(fn) + ':' + String(mm);
        }
        return String(t) + ':' + String(m.content || '');
      } catch (e) {
        return '';
      }
    }

    function findOptimisticForAck(serverMsg) {
      try {
        if (!serverMsg || typeof serverMsg !== 'object') return null;
        normalizeMessage(serverMsg, currentChatId.value === 'global');
        if (!selfUserId.value) return null;
        const from = serverMsg.from_user;
        if (!from) return null;
        if (String(from) !== String(selfUserId.value)) return null;

        const sig = contentSignature(serverMsg);
        const now = parseMessageTime(serverMsg) ? parseMessageTime(serverMsg).getTime() : Date.now();

        const arr = messages.value || [];
        for (let i = arr.length - 1; i >= 0; i--) {
          const m = arr[i];
          if (!m || !m.id) continue;
          if (m.__status !== 'sending') continue;
          if (m.__own !== true) continue;
          if ((m.type || 'text') !== (serverMsg.type || 'text')) continue;

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

        // socket may have already inserted this server message
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

        // move mapping tempId -> serverId
        delete msgById[tempId];
        optimistic.__status = 'sent';
        optimistic.id = serverId;
        if (serverMsg.type) optimistic.type = serverMsg.type;
        if (serverMsg.from_user) optimistic.from_user = serverMsg.from_user;
        if (serverMsg.created_at || serverMsg.createdAt) optimistic.created_at = serverMsg.created_at || serverMsg.createdAt;
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

    function toggleMessageTime(m) {
      if (!m) return;
      m.__showTime = !m.__showTime;
    }

    function onTouchStart(m, event) {
      if (isGlobalChat.value) return;
      longPressTarget.value = m;
      longPressTimer.value = setTimeout(() => {
        if (longPressTarget.value === m) {
          showContextMenu(m, event);
        }
      }, 500);
    }

    function updateInputAreaHeightVar() {
      try {
        const el = inputAreaEl.value;
        if (!el) return;
        const h = el.offsetHeight || 0;
        document.documentElement.style.setProperty('--input-area-height', `${h}px`);
      } catch (e) {}
    }

    function restoreViewportScale() {
      try {
        const meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        meta.setAttribute(
          'content',
          'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
        );
      } catch (e) {}
    }

    function onTouchMove() {
      if (longPressTimer.value) {
        clearTimeout(longPressTimer.value);
        longPressTimer.value = null;
      }
      longPressTarget.value = null;
    }

    function onTouchEnd() {
      if (longPressTimer.value) {
        clearTimeout(longPressTimer.value);
        longPressTimer.value = null;
      }
      longPressTarget.value = null;
    }

    function showContextMenu(m, event) {
      ctxMenuMsg.value = m;
      
      // 获取触摸位置
      const touch = event.touches[0] || event.changedTouches[0];
      let x = touch.clientX;
      let y = touch.clientY;
      
      // 确保菜单不会超出屏幕
      const menuWidth = 140;
      const menuHeight = 140;
      
      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        y = y - menuHeight - 10;
      }
      
      ctxMenuX.value = x;
      ctxMenuY.value = y;
      ctxMenuVisible.value = true;
      
      // 给震动反馈（如果支持）
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
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

    function applyMessageUpdate(chatId, updated) {
      try {
        if (!updated || typeof updated !== 'object') return;
        if (!updated.id) return;
        normalizeMessage(updated, chatId === 'global');
        if (msgById[updated.id]) {
          try { Object.assign(msgById[updated.id], updated); } catch (e) {}
        } else if (currentChatId.value && chatId && String(chatId) === String(currentChatId.value)) {
          msgById[updated.id] = updated;
          messages.value.push(updated);
        }
      } catch (e) {}
    }

    async function postRecallRequest(messageId) {
      const mid = messageId !== undefined && messageId !== null ? String(messageId) : '';
      if (!mid) throw new Error('missing messageId');

      const endpoints = [];
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
      hideContextMenu();
      try {
        if (!canRecallMessage(msg)) {
          try { ElementPlus.ElMessage.warning('只能撤回 2 分钟内发送的消息'); } catch (e) {}
          return;
        }
        const result = await postRecallRequest(msg.id);
        const updated = (result && result.message) ? result.message : null;
        if (updated) applyMessageUpdate(updated.chatId || updated.chat_id || currentChatId.value, updated);
      } catch (e) {
        const m = e && e.message ? String(e.message) : '撤回失败';
        try { ElementPlus.ElMessage.error(m); } catch (e2) {}
      }
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
        imagePreviewMoved.value = false;
      } catch (e) {}
    }

    function requestCloseImagePreview() {
      try {
        // 防止拖动/捏合结束后产生的合成 click 误触关闭
        if (imgDragActive || imgPinchActive) return;
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

    function touchPoint(t) {
      return { x: Number(t && t.clientX) || 0, y: Number(t && t.clientY) || 0 };
    }

    function touchDistance(t1, t2) {
      const a = touchPoint(t1);
      const b = touchPoint(t2);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function touchCenter(t1, t2) {
      const a = touchPoint(t1);
      const b = touchPoint(t2);
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function onImagePreviewTouchStart(ev) {
      try {
        const touches = ev && ev.touches ? ev.touches : [];
        if (touches.length === 2) {
          imgTapCandidate = false;
          imgPinchActive = true;
          imgDragActive = false;
          imgPinchStartDist = touchDistance(touches[0], touches[1]) || 1;
          imgPinchStartScale = Number(imagePreviewScale.value) || 1;
          const c = touchCenter(touches[0], touches[1]);
          imgPinchStartCenterX = c.x;
          imgPinchStartCenterY = c.y;
          imgPinchLastCenterX = c.x;
          imgPinchLastCenterY = c.y;
          imgPinchOriginX = Number(imagePreviewX.value) || 0;
          imgPinchOriginY = Number(imagePreviewY.value) || 0;
          return;
        }
        if (touches.length === 1) {
          imgTapCandidate = true;
          imgTapStartX = Number(touches[0].clientX) || 0;
          imgTapStartY = Number(touches[0].clientY) || 0;

          imgDragActive = true;
          imgPinchActive = false;
          imgDragStartX = Number(touches[0].clientX) || 0;
          imgDragStartY = Number(touches[0].clientY) || 0;
          imgDragOriginX = Number(imagePreviewX.value) || 0;
          imgDragOriginY = Number(imagePreviewY.value) || 0;
        }
      } catch (e) {}
    }

    function onImagePreviewTouchMove(ev) {
      try {
        const touches = ev && ev.touches ? ev.touches : [];
        if (imgPinchActive && touches.length === 2) {
          const target = ev.currentTarget || ev.target;
          const rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
          const c = touchCenter(touches[0], touches[1]);

          // Pan following the moving pinch center.
          const panDx = c.x - imgPinchLastCenterX;
          const panDy = c.y - imgPinchLastCenterY;
          imgPinchLastCenterX = c.x;
          imgPinchLastCenterY = c.y;
          if (Math.abs(panDx) > 1 || Math.abs(panDy) > 1) imagePreviewMoved.value = true;

          const dist = touchDistance(touches[0], touches[1]) || 1;
          const desiredScale = clampImageScale(imgPinchStartScale * (dist / imgPinchStartDist));
          const oldScale = Number(imagePreviewScale.value) || 1;

          if (Math.abs(desiredScale - oldScale) > 0.01) imagePreviewMoved.value = true;

          // First: scale around current two-finger center.
          if (rect && desiredScale !== oldScale) {
            const px = c.x - rect.left;
            const py = c.y - rect.top;
            const curX = Number(imagePreviewX.value) || 0;
            const curY = Number(imagePreviewY.value) || 0;
            imagePreviewX.value = curX + px * (1 - desiredScale / oldScale);
            imagePreviewY.value = curY + py * (1 - desiredScale / oldScale);
            imagePreviewScale.value = desiredScale;
          } else if (!rect) {
            imagePreviewScale.value = desiredScale;
          }

          // Then: apply pan.
          imagePreviewX.value = (Number(imagePreviewX.value) || 0) + panDx;
          imagePreviewY.value = (Number(imagePreviewY.value) || 0) + panDy;

          if (desiredScale === 1) {
            imagePreviewX.value = 0;
            imagePreviewY.value = 0;
          }

          return;
        }

        if (imgDragActive && touches.length === 1) {
          const x = Number(touches[0].clientX) || 0;
          const y = Number(touches[0].clientY) || 0;

          if (imgTapCandidate) {
            const mdx = x - imgTapStartX;
            const mdy = y - imgTapStartY;
            if (Math.abs(mdx) > 8 || Math.abs(mdy) > 8) imgTapCandidate = false;
          }

          const dx = x - imgDragStartX;
          const dy = y - imgDragStartY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) imagePreviewMoved.value = true;
          imagePreviewX.value = imgDragOriginX + dx;
          imagePreviewY.value = imgDragOriginY + dy;
        }
      } catch (e) {}
    }

    function onImagePreviewTouchEnd(ev) {
      try {
        const touches = ev && ev.touches ? ev.touches : [];
        if (touches.length === 0) {
          if (imgTapCandidate) {
            imgTapCandidate = false;
            imgDragActive = false;
            imgPinchActive = false;
            closeImagePreview();
            return;
          }
          imgTapCandidate = false;
          imgDragActive = false;
          imgPinchActive = false;
        }
        if (touches.length === 1) {
          imgPinchActive = false;
          imgDragActive = true;
          imgDragStartX = Number(touches[0].clientX) || 0;
          imgDragStartY = Number(touches[0].clientY) || 0;
          imgDragOriginX = Number(imagePreviewX.value) || 0;
          imgDragOriginY = Number(imagePreviewY.value) || 0;
        }
      } catch (e) {}
    }

    function onMaskTouchStart(ev) {
      try {
        const t = ev && ev.touches && ev.touches[0] ? ev.touches[0] : null;
        maskTapCandidate = true;
        maskTapStartX = Number(t && t.clientX) || 0;
        maskTapStartY = Number(t && t.clientY) || 0;
      } catch (e) {}
    }

    function onMaskTouchMove(ev) {
      try {
        if (!maskTapCandidate) return;
        const t = ev && ev.touches && ev.touches[0] ? ev.touches[0] : null;
        const x = Number(t && t.clientX) || 0;
        const y = Number(t && t.clientY) || 0;
        if (Math.abs(x - maskTapStartX) > 8 || Math.abs(y - maskTapStartY) > 8) {
          maskTapCandidate = false;
        }
      } catch (e) {}
    }

    function onMaskTouchEnd() {
      try {
        if (!maskTapCandidate) return;
        maskTapCandidate = false;
        requestCloseImagePreview();
      } catch (e) {}
    }

    function hideContextMenu() {
      ctxMenuVisible.value = false;
      ctxMenuMsg.value = null;
    }

    function ctxReply() {
      if (ctxMenuMsg.value) {
        setReplyTarget(ctxMenuMsg.value);
      }
      hideContextMenu();
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
      hideContextMenu();

      try {
        const res = await safeFetch(`${apiBase.value}/emoji/collect/${encodeURIComponent(msg.id)}`, {
          method: 'POST',
        });
        if (res.ok) {
          try { ElementPlus.ElMessage.success('已添加到表情包'); } catch (e) {}
          try { await loadEmojiPacks(); } catch (e2) {}
          return;
        }

        let err = '';
        try {
          const data = await res.json().catch(() => null);
          err = data && (data.error || data.message) ? String(data.error || data.message) : '';
        } catch (e) {}
        if (!err) err = `操作失败 (${res.status})`;
        try {
          if (res.status === 400) ElementPlus.ElMessage.warning(err);
          else ElementPlus.ElMessage.error(err);
        } catch (e2) {}
      } catch (e) {
        try { ElementPlus.ElMessage.error('添加失败'); } catch (e2) {}
      }
    }

    function setReplyTarget(m) {
      replyTarget.value = m;
    }

    function connectSocket() {
      if (socket.value?.connected) return;
      const opts = {
        path: '/api/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: true,
      };
      const t = token.value;
      if (t) opts.auth = { token: t };

      const s = window.io(window.location.origin, opts);
      socket.value = s;

      s.on('connect', () => {
        if (currentChatId.value && currentChatId.value !== joinedChatId.value) {
          s.emit('join', currentChatId.value);
          joinedChatId.value = currentChatId.value;
        }
      });

      s.on('message.created', async (msg) => {
        try {
          const chatId = msg.chatId || msg.chat_id;
          if (!currentChatId.value) return;
          if (chatId && String(chatId) !== String(currentChatId.value)) return;

          normalizeMessage(msg, currentChatId.value === 'global');
          if (!msg.id) return;

          // already have this server message
          if (msgById[msg.id]) {
            try {
              Object.assign(msgById[msg.id], msg);
            } catch (e) {}
            return;
          }

          // treat incoming self message as ACK for optimistic one (desktop behavior)
          const optimistic = findOptimisticForAck(msg);
          if (optimistic && optimistic.id) {
            ackOptimisticMessage(optimistic.id, msg, currentChatId.value === 'global');
          } else {
            msgById[msg.id] = msg;
            messages.value.push(msg);
          }

          await nextTick();
          if (messagesEl.value) {
            messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
          }
        } catch (e) {}
      });

      function onMessageUpdatedLike(payload) {
        try {
          const chatId = payload && (payload.chatId || payload.chat_id);
          const updated = payload && payload.message ? payload.message : payload;
          if (!updated || typeof updated !== 'object') return;

          const cid = chatId || updated.chatId || updated.chat_id || null;
          if (!currentChatId.value) return;
          if (cid && String(cid) !== String(currentChatId.value)) return;

          applyMessageUpdate(cid || currentChatId.value, updated);
        } catch (e) {}
      }

      s.on('message.recalled', onMessageUpdatedLike);
      s.on('message.updated', onMessageUpdatedLike);
    }

    function joinSocketRoom(chatId) {
      if (socket.value?.connected) {
        socket.value.emit('join', chatId);
        joinedChatId.value = chatId;
      }
    }

    function scrollMessagesToBottom() {
      try {
        const el = messagesEl.value;
        if (!el) return;
        const doScroll = () => {
          try {
            const top = el.scrollHeight;
            if (typeof el.scrollTo === 'function') {
              el.scrollTo({ top, behavior: 'auto' });
            } else {
              el.scrollTop = top;
            }
          } catch (e) {}
        };

        // iOS/WebView sometimes needs multiple layout frames before scrollHeight is stable.
        doScroll();
        requestAnimationFrame(() => doScroll());
        setTimeout(() => doScroll(), 60);
      } catch (e) {}
    }

    async function openChat(id) {
      chatLoading.value = true;
      currentChatId.value = id;
      const isGlobal = id === 'global';

      loadingMore.value = false;
      noMoreBefore.value = false;

      try {
        if (isGlobal) {
          currentChatTitle.value = '全服';
          currentChatFaceUrl.value = '/img/Ag_0404.png';
        } else {
          const metaRes = await safeFetch(`${apiBase.value}/chats/${encodeURIComponent(id)}`);
          if (metaRes.ok) {
            const chatMeta = await metaRes.json();
            currentChatTitle.value = chatMeta.displayName || chatMeta.name || '';
            const members = chatMeta.members || chatMeta.memberIds || [];
            if (selfUserId.value) {
              const selfId = String(selfUserId.value);
              if (Array.isArray(members) && members.length === 1 && String(members[0]) === selfId) {
                currentChatFaceUrl.value = getCachedFaceUrl(selfId);
                if (!currentChatTitle.value) currentChatTitle.value = '我';
              } else if (Array.isArray(members) && members.length === 2) {
                const a = String(members[0]);
                const b = String(members[1]);
                if (a === selfId && b === selfId) {
                  currentChatFaceUrl.value = getCachedFaceUrl(selfId);
                  if (!currentChatTitle.value) currentChatTitle.value = '我';
                } else {
                  const otherId = [a, b].find((m) => String(m) !== selfId);
                  if (otherId) {
                    currentChatFaceUrl.value = getCachedFaceUrl(otherId);
                    if (!currentChatTitle.value) {
                      currentChatTitle.value = userNameCache[otherId] || otherId;
                    }
                  }
                }
              }
            }
          }
        }

        const msgUrl = buildMessagesUrl(id, { limit: INITIAL_LIMIT });
        
        const res = await safeFetch(msgUrl);
        if (!res.ok) throw new Error('加载消息失败');
        let msgs = await res.json();

        // Safety: if backend ignores limit and returns full history, only render latest initial page.
        if (Array.isArray(msgs) && msgs.length > INITIAL_LIMIT) msgs = msgs.slice(-INITIAL_LIMIT);

        messages.value = [];
        for (const k of Object.keys(msgById)) delete msgById[k];

        msgs.forEach(m => {
          normalizeMessage(m, isGlobal);
          if (m.id) msgById[m.id] = m;
        });
        messages.value = msgs;
        noMoreBefore.value = !Array.isArray(msgs) || msgs.length < INITIAL_LIMIT;

        await nextTick();
        scrollMessagesToBottom();

        connectSocket();
        joinSocketRoom(id);
      } catch (e) {
        console.error(e);
        ElementPlus.ElMessage.error('无法打开会话');
      } finally {
        chatLoading.value = false;
        await nextTick();
        scrollMessagesToBottom();
      }
    }

    async function loadMoreMessages() {
      if (!currentChatId.value) return;
      if (loadingMore.value || noMoreBefore.value) return;
      if (!messagesEl.value) return;
      const first = (messages.value || [])[0];
      if (!first || !first.id) return;

      loadingMore.value = true;
      const beforeId = first.id;
      const isGlobal = currentChatId.value === 'global';

      try {
        const url = buildMessagesUrl(currentChatId.value, { beforeId, limit: PAGE_LIMIT });

        const prevScrollHeight = messagesEl.value.scrollHeight;
        const prevScrollTop = messagesEl.value.scrollTop;

        const res = await safeFetch(url);
        if (!res.ok) throw new Error('load more failed');
        const more = await res.json().catch(() => null);
        if (!Array.isArray(more) || more.length === 0) {
          noMoreBefore.value = true;
          return;
        }

        more.forEach((m) => {
          normalizeMessage(m, isGlobal);
          if (m && m.id) msgById[m.id] = m;
        });

        messages.value = more.concat(messages.value).map((m) => normalizeMessage(m, isGlobal));

        await nextTick();
        const newScrollHeight = messagesEl.value.scrollHeight;
        messagesEl.value.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;

        if (more.length < PAGE_LIMIT) noMoreBefore.value = true;
      } catch (e) {
        // ignore
      } finally {
        loadingMore.value = false;
      }
    }

    async function sendText() {
      const text = (msgInput.value || '').trim();
      if (!text || !currentChatId.value) return;

      // Some browsers/WebViews change zoom during input; force restore to 1x.
      restoreViewportScale();

      const tempId = 'temp_' + Date.now() + '_' + Math.random();
      const optimisticMsg = {
        id: tempId,
        type: 'text',
        content: { text },
        from_user: selfUserId.value,
        created_at: new Date().toISOString(),
        __status: 'sending',
        __own: true,
      };
      if (replyTarget.value && !isGlobalChat.value) {
        optimisticMsg.replied_to = replyTarget.value.id;
      }

      msgById[tempId] = optimisticMsg;
      messages.value.push(optimisticMsg);
      msgInput.value = '';
      clearReplyTarget();

      restoreViewportScale();

      await nextTick();
      if (messagesEl.value) {
        messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
      }

      try {
        const isGlobal = currentChatId.value === 'global';
        const url = isGlobal
          ? `${apiBase.value}/global/messages`
          : `${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`;

        const body = isGlobal ? { content: text } : { type: 'text', content: text };
        if (!isGlobal && optimisticMsg.replied_to) body.repliedTo = optimisticMsg.replied_to;

        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const serverMsg = await res.json();
          ackOptimisticMessage(tempId, serverMsg, isGlobal);
        } else {
          optimisticMsg.__status = 'failed';
        }
      } catch (e) {
        optimisticMsg.__status = 'failed';
      } finally {
        restoreViewportScale();
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
      if (!currentChatId.value) return;
      if (isGlobalChat.value) return;

      restoreViewportScale();

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
        created_at: new Date().toISOString(),
        __own: true,
        __status: 'sending',
      };
      if (replyTarget.value) optimisticMsg.replied_to = replyTarget.value.id;

      msgById[tempId] = optimisticMsg;
      messages.value.push(optimisticMsg);
      await nextTick();
      if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;

      restoreViewportScale();

      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('type', 'file');
        if (replyTarget.value) fd.append('repliedTo', replyTarget.value.id || String(replyTarget.value));

        const res = await safeFetch(
          `${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`,
          {
            method: 'POST',
            body: fd,
          }
        );
        if (!res.ok) throw new Error('send file failed');
        const serverMsg = await res.json().catch(() => null);
        if (serverMsg) {
          ackOptimisticMessage(tempId, serverMsg, false);
        } else {
          optimisticMsg.__status = 'failed';
        }
        clearReplyTarget();
      } catch (e) {
        optimisticMsg.__status = 'failed';
        try {
          ElementPlus.ElMessage.error('发送文件失败');
        } catch (e2) {}
      } finally {
        await nextTick();
        if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
        restoreViewportScale();
      }
    }

    function clearReplyTarget() {
      replyTarget.value = null;
    }

    function toggleEmojiPanel() {
      emojiPanelVisible.value = !emojiPanelVisible.value;
    }

    async function loadEmojiPacks() {
      try {
        const res = await safeFetch(`${apiBase.value}/emoji`);
        if (res.ok) {
          const packs = await res.json();
          emojiPacks.value = (Array.isArray(packs) ? packs : []).map(p => ({
            id: p.id,
            url:
              p.url ||
              p.downloadUrl ||
              p.download_url ||
              `${apiBase.value}/emoji/${encodeURIComponent(p.id)}/download`,
            name: p.name || (p.meta && p.meta.filename) || p.filename || '',
          }));
        }
      } catch (e) {}
    }

    async function sendEmoji(pack) {
      if (!currentChatId.value || isGlobalChat.value) return;
      
      emojiPanelVisible.value = false;
      
      try {
        const url = `${apiBase.value}/chats/${encodeURIComponent(currentChatId.value)}/messages`;
        const body = {
          type: 'emoji',
          content: { packId: pack.id, url: pack.url },
        };
        if (replyTarget.value) body.repliedTo = replyTarget.value.id;

        const res = await safeFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        clearReplyTarget();
      } catch (e) {
        ElementPlus.ElMessage.error('发送表情失败');
      }
    }

    function goBack() {
      window.location.href = '/m/chats.html';
    }

    function goEmojiManage() {
      window.location.href = '/m/emojis.html';
    }

    function onMessagesScroll() {
      try {
        if (!messagesEl.value) return;
        if (messagesEl.value.scrollTop < 80) {
          loadMoreMessages();
        }
      } catch (e) {}
    }

    onMounted(async () => {
      await fetchConfig();
      await loadUsersIndex();
      await resolveSelfProfile();
      await loadEmojiPacks();

      await nextTick();
      updateInputAreaHeightVar();
      window.addEventListener('resize', updateInputAreaHeightVar);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateInputAreaHeightVar);
        window.visualViewport.addEventListener('scroll', updateInputAreaHeightVar);
      }

      const params = new URLSearchParams(window.location.search);
      const chatId = params.get('chat');
      if (chatId) {
        await openChat(chatId);
      }

      // 点击页面其他地方关闭上下文菜单
      document.addEventListener('click', () => {
        hideContextMenu();
      });
    });

    return {
      currentChatTitle,
      currentChatFaceUrl,
      messages,
      msgInput,
      imagePreviewVisible,
      imagePreviewUrl,
      imagePreviewStyle,
      fileInputEl,
      inputAreaEl,
      messagesEl,
      chatLoading,
      loadingMore,
      isGlobalChat,
      replyTarget,
      replyPreview,
      emojiPanelVisible,
      emojiPacks,
      ctxMenuVisible,
      ctxMenuX,
      ctxMenuY,
      ctxMenuMsg,
      canCollectEmoji,
      ctxCollectEmoji,
      messageAuthorName,
      messageAuthorFaceUrl,
      messagePreviewTag,
      messagePreviewSuffix,
      messagePreviewText,
      messageTextPreview,
      isRecalledMessage,
      recallNoticeText,
      isOwnMessage,
      isImageFile,
      isVideoFile,
      fileDisplayUrl,
      bubbleBackground,
      formatTime,
      shouldShowTimeDivider,
      repliedRefMessage,
      scrollToMessage,
      toggleMessageTime,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      ctxReply,
      canRecallMessage,
      ctxRecall,
      setReplyTarget,
      sendText,
      openFilePicker,
      onFileSelected,
      clearReplyTarget,
      toggleEmojiPanel,
      sendEmoji,
      openImagePreview,
      closeImagePreview,
      requestCloseImagePreview,
      onImagePreviewToggle,
      onImagePreviewTouchStart,
      onImagePreviewTouchMove,
      onImagePreviewTouchEnd,
      onMaskTouchStart,
      onMaskTouchMove,
      onMaskTouchEnd,
      goBack,
      goEmojiManage,
      onMessagesScroll,
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
