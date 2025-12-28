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

    async function loadChats() {
      try {
        const res = await safeFetch(`${apiBase.value}/chats`);
        if (!res.ok) return;
        chats.value = await res.json();
      } catch (e) {}
    }

    async function loadUsersIndex() {
      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return;
        const users = await res.json();
        users.forEach(u => {
          const id = String(u.id);
          userNameCache[id] = u.username || u.id;
          const face = u.faceUrl || u.face_url || u.face || '';
          if (face) userFaceCache[id] = face;
        });
      } catch (e) {}
    }

    async function resolveSelfProfile() {
      try {
        const res = await safeFetch(`${apiBase.value}/me`);
        if (!res.ok) return;
        const me = await res.json();
        selfUserId.value = me.id;
        const face = me.faceUrl || me.face_url || me.face;
        if (face) selfFaceUrl.value = String(face);
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
      return !!chatUnreadMap[chatId];
    }

    function openGlobal() {
      window.location.href = '/m/chat_detail.html?chat=global';
    }

    function openChat(chat) {
      window.location.href = `/m/chat_detail.html?chat=${encodeURIComponent(chat.id)}`;
    }

    onMounted(async () => {
      await fetchConfig();
      await loadUsersIndex();
      await resolveSelfProfile();
      await loadChats();
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
