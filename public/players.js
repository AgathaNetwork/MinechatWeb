// Vue 3 players page
const { createApp, ref, onMounted } = Vue;

createApp({
  setup(){
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const q = ref('');
    const users = ref([]);
    const filtered = ref([]);

    function authHeaders(extra){
      const h = Object.assign({}, extra || {});
      if(token.value) h['Authorization'] = `Bearer ${token.value}`;
      return h;
    }

    async function fetchConfig(){ const conf = await fetch('/config').then(r=>r.json()); apiBase.value = conf.apiProxyBase || conf.apiBase; }
    async function loadUsers(){
      try{
        const res = await fetch(`${apiBase.value}/users`, {
          credentials: 'include',
          headers: authHeaders(),
        });
        if(res.status === 204){
          users.value = [];
          filtered.value = [];
          return;
        }
        if(!res.ok){
          const txt = await res.text().catch(()=> '');
          throw new Error(`load users failed: ${res.status} ${txt}`);
        }
        users.value = await res.json();
        filtered.value = users.value.slice();
      }catch(e){
        console.error(e);
        alert('无法加载玩家列表：' + (e && e.message ? e.message : e));
      }
    }

    function onInput(){ const s = q.value.trim().toLowerCase(); if(!s){ filtered.value = users.value.slice(); return; } filtered.value = users.value.filter(u=> (u.username||u.id||'').toLowerCase().includes(s)); }

    async function openChat(userId){
      try{
        const res = await fetch(`${apiBase.value}/chats/with/${encodeURIComponent(userId)}`, {
          method: 'POST',
          credentials: 'include',
          headers: authHeaders(),
        });
        if(!res.ok){
          const txt = await res.text().catch(()=> '');
          throw new Error(`open/create chat failed: ${res.status} ${txt}`);
        }
        const data = await res.json(); const chatId = data.chatId || (data.chat && data.chat.id) || null;
        if(!chatId) throw new Error('no chatId');
        window.location.href = `/chat.html?open=${encodeURIComponent(chatId)}`;
      }catch(e){ console.error(e); alert('打开或创建私聊失败'); }
    }

    function onNav(key){
      if(key === 'chat') window.location.href = '/chat.html';
      else if(key === 'players') window.location.href = '/players.html';
    }

    function logout(){ token.value=null; localStorage.removeItem('token'); window.location.href = '/'; }

    onMounted(async ()=>{ await fetchConfig(); await loadUsers(); });
    return { q, filtered, onInput, openChat, logout, onNav };
  }
}).use(ElementPlus).mount('#app');
