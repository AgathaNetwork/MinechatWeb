// Vue 3 players page
const { createApp, ref, onMounted } = Vue;

const app = createApp({
  setup(){
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const selfFaceUrl = ref('');
    const selfUserId = ref(null);
    const q = ref('');
    const users = ref([]);
    const filtered = ref([]);
    const usersLoading = ref(false);

    const groupMode = ref(false);
    const groupName = ref('');
    const selectedMap = ref({});
    const createGroupLoading = ref(false);

    const briefDialogVisible = ref(false);
    const briefLoading = ref(false);
    const briefError = ref('');
    const briefRows = ref([]);
    const briefDisplayName = ref('');
    const briefUuid = ref('');
    const briefFaceUrl = ref('');
    const briefInitial = ref('');

    function parseDate(v){
      try{
        if(v === null || v === undefined) return null;
        if(typeof v === 'number'){
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        }
        const s = String(v).trim();
        if(!s) return null;
        const n = Number(s);
        if(!Number.isNaN(n) && n > 0 && s.length >= 10){
          const d = new Date(n);
          if(!isNaN(d.getTime())) return d;
        }
        const d2 = new Date(s);
        return isNaN(d2.getTime()) ? null : d2;
      }catch(e){
        return null;
      }
    }

    function formatYmd(d){
      try{
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      }catch(e){
        return '';
      }
    }

    function formatYmdHm(d){
      try{
        const ymd = formatYmd(d);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return ymd ? `${ymd} ${hh}:${mm}` : '';
      }catch(e){
        return '';
      }
    }

    function tokenValue(){
      const t = (token.value || '').trim();
      return t ? t : null;
    }

    function clearBadToken(){
      token.value = null;
      try{ localStorage.removeItem('token'); }catch(e){}
    }

    function authHeaders(extra){
      const h = Object.assign({}, extra || {});
      const t = tokenValue();
      if(t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options, allowRetry){
      const opt = Object.assign({ credentials: 'include' }, options || {});
      opt.headers = authHeaders(opt.headers);
      const res = await fetch(url, opt);

      const canRetry = allowRetry !== false;
      if(canRetry && res.status === 401){
        let txt = '';
        try{ txt = await res.clone().text(); }catch(e){}
        if(/invalid token/i.test(txt)){
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

    function decodeJwtPayload(jwt){
      try{
        const parts = String(jwt || '').split('.');
        if(parts.length !== 3) return null;
        const payload = parts[1].replace(/-/g,'+').replace(/_/g,'/');
        const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
        const json = atob(padded);
        return JSON.parse(json);
      }catch(e){
        return null;
      }
    }

    async function resolveSelfFace(){
      // 1) Best-effort /users/me
      try{
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if(res.ok){
          const me = await res.json().catch(()=>null);
          if(me && typeof me === 'object'){
            const meId = me.id || me.userId || me.uid;
            if(meId !== undefined && meId !== null) selfUserId.value = String(meId);
            const face = me.faceUrl || me.face_url || me.face;
            const f2 = face || me.face_key;
            if(f2){ selfFaceUrl.value = String(f2); return; }
            if(meId){
              const u = users.value.find(x => x && String(x.id) === String(meId));
              const f = u && (u.faceUrl || u.face_url || u.face);
              const f3 = f || (u && u.face_key);
              if(f3){ selfFaceUrl.value = String(f3); return; }
            }
          }
        }
      }catch(e){}

      // 2) Fallback: infer id from JWT token and match in /users list
      const t = tokenValue();
      if(!t) return;
      const payload = decodeJwtPayload(t);
      const meId = payload && (payload.userId || payload.uid || payload.id || payload.sub);
      if(!meId) return;
      selfUserId.value = String(meId);
      const u = users.value.find(x => x && String(x.id) === String(meId));
      const face = u && (u.faceUrl || u.face_url || u.face);
      const f2 = face || (u && u.face_key);
      if(f2) selfFaceUrl.value = String(f2);
    }

    async function fetchConfig(){ const conf = await fetch('/config').then(r=>r.json()); apiBase.value = conf.apiProxyBase || conf.apiBase; }
    async function loadUsers(){
      usersLoading.value = true;
      try{
        const res = await safeFetch(`${apiBase.value}/users`);
        if(res.status === 204){
          users.value = [];
          filtered.value = [];
          return;
        }
        if(!res.ok){
          const txt = await res.text().catch(()=> '');
          throw new Error(`load users failed: ${res.status} ${txt}`);
        }
        const raw = await res.json();

        function extractMinecraftUuid(obj){
          try{
            if(!obj || typeof obj !== 'object') return '';
            const candidates = [obj.minecraftUuid, obj.minecraft_uuid, obj.minecraftUUID, obj.mcUuid, obj.mc_uuid, obj.uuid];
            for(const c of candidates){
              if(c !== undefined && c !== null && String(c).trim()) return String(c).trim();
            }
            return '';
          }catch(e){
            return '';
          }
        }

        function extractFaceUrl(obj){
          try{
            if(!obj || typeof obj !== 'object') return '';
            const face = obj.faceUrl || obj.face_url || obj.face || obj.face_key || '';
            return face ? String(face) : '';
          }catch(e){
            return '';
          }
        }

        users.value = Array.isArray(raw) ? raw.map(u => Object.assign({}, u, { mcUuid: extractMinecraftUuid(u), faceUrl: extractFaceUrl(u) })) : [];
        filtered.value = users.value.slice();

        // update self avatar after list is ready
        await resolveSelfFace();
      }catch(e){
        console.error(e);
        alert('无法加载玩家列表：' + (e && e.message ? e.message : e));
      }finally{
        usersLoading.value = false;
      }
    }

    function onInput(){ const s = q.value.trim().toLowerCase(); if(!s){ filtered.value = users.value.slice(); return; } filtered.value = users.value.filter(u=> (u.username||u.id||'').toLowerCase().includes(s)); }

    function enterGroupMode(){
      groupMode.value = true;
      groupName.value = '';
      selectedMap.value = {};
    }

    function cancelGroupMode(){
      groupMode.value = false;
      groupName.value = '';
      selectedMap.value = {};
    }

    function isSelected(userId){
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      return id ? !!selectedMap.value[id] : false;
    }

    function setSelected(userId, val){
      const id = userId !== undefined && userId !== null ? String(userId) : '';
      if(!id) return;
      selectedMap.value = Object.assign({}, selectedMap.value, { [id]: !!val });
    }

    function selectedCount(){
      try{
        return Object.values(selectedMap.value || {}).filter(Boolean).length;
      }catch(e){
        return 0;
      }
    }

    async function createGroupChat(){
      if(createGroupLoading.value) return;
      const picked = Object.entries(selectedMap.value || {}).filter(([,v])=>!!v).map(([k])=>String(k));
      const selfId = selfUserId.value ? String(selfUserId.value) : null;
      const members = picked.filter(id => !selfId || String(id) !== String(selfId));
      if(members.length < 2){
        alert('创建群聊需要至少选择 2 位其他玩家');
        return;
      }

      createGroupLoading.value = true;
      try{
        const base = String(apiBase.value || '').replace(/\/$/, '');
        const res = await safeFetch(`${base}/chats/group`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: (groupName.value || '').trim() || null, members }),
        });
        if(!res.ok){
          const txt = await res.text().catch(()=> '');
          throw new Error(`create group failed: ${res.status} ${txt}`);
        }
        const chat = await res.json().catch(()=> null);
        const chatId = chat && (chat.id || chat.chatId || (chat.chat && chat.chat.id) || (chat.chat && chat.chat.chatId));
        if(!chatId) throw new Error('no chatId');
        window.location.href = `/chat.html?open=${encodeURIComponent(chatId)}`;
      }catch(e){
        console.error(e);
        alert('创建群聊失败：' + (e && e.message ? e.message : e));
      }finally{
        createGroupLoading.value = false;
      }
    }

    async function openChat(userId){
      try{
        const res = await safeFetch(`${apiBase.value}/chats/with/${encodeURIComponent(userId)}`, { method: 'POST' });
        if(!res.ok){
          const txt = await res.text().catch(()=> '');
          throw new Error(`open/create chat failed: ${res.status} ${txt}`);
        }
        const data = await res.json(); const chatId = data.chatId || (data.chat && data.chat.id) || null;
        if(!chatId) throw new Error('no chatId');
        window.location.href = `/chat.html?open=${encodeURIComponent(chatId)}`;
      }catch(e){ console.error(e); alert('打开或创建私聊失败'); }
    }

    async function openBrief(user){
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

      if(!name){
        briefError.value = '缺少用户名';
        briefLoading.value = false;
        return;
      }

      try{
        const res = await safeFetch(`${apiBase.value}/info/playerBrief?username=${encodeURIComponent(name)}`);
        if(!res.ok){
          const txt = await res.text().catch(()=> '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(()=> null);
        if(!data || typeof data !== 'object' || Number(data.return) !== 1){
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
      }catch(e){
        briefError.value = e && e.message ? e.message : String(e);
      }finally{
        briefLoading.value = false;
      }
    }

    function onNav(key){
      if(key === 'chat') window.location.href = '/chat.html';
      else if(key === 'players') window.location.href = '/players.html';
      else if(key === 'gallery') window.location.href = '/gallery.html';
      else if(key === 'me') window.location.href = '/me.html';
    }

    function logout(){ token.value=null; localStorage.removeItem('token'); window.location.href = '/'; }

    onMounted(async ()=>{ await fetchConfig(); await loadUsers(); });
    return {
      q,
      filtered,
      onInput,
      openChat,
      openBrief,
      logout,
      onNav,
      selfFaceUrl,
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
      createGroupLoading,
      enterGroupMode,
      cancelGroupMode,
      isSelected,
      setSelected,
      selectedCount,
      createGroupChat,
    };
  }
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
