// Vue 3 emoji management page
const { createApp, ref, onMounted } = Vue;

createApp({
  setup(){
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const name = ref('');
    const packs = ref([]);
    const fileInput = ref(null);

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

    async function fetchConfig(){
      const conf = await fetch('/config').then(r=>r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase;
    }
    async function loadPacks(){
      try{
        const r = await safeFetch(`${apiBase.value}/emoji`);
        if(r.ok) packs.value = await r.json();
      }catch(e){ console.error(e); }
    }

    async function upload(){
      const fileEl = fileInput.value; if(!fileEl || !fileEl.files || !fileEl.files[0]) return alert('请选择文件');
      const f = fileEl.files[0]; const fd = new FormData(); fd.append('file', f); if(name.value) fd.append('name', name.value);
      try{
        const r = await safeFetch(`${apiBase.value}/emoji`, { method:'POST', body: fd });
        if(!r.ok) throw new Error('upload failed');
        name.value='';
        fileEl.value='';
        await loadPacks();
      }catch(e){ console.error(e); alert('上传失败'); }
    }

    async function del(id){
      if(!confirm('删除该表情包？')) return;
      try{
        const r = await safeFetch(`${apiBase.value}/emoji/${encodeURIComponent(id)}`, { method:'DELETE' });
        if(!r.ok) throw new Error('delete failed');
        await loadPacks();
      }catch(e){ console.error(e); alert('删除失败'); }
    }

    function logout(){ token.value=null; localStorage.removeItem('token'); window.location.href = '/'; }

    function onNav(key){
      if(key === 'chat') window.location.href = '/chat.html';
      else if(key === 'players') window.location.href = '/players.html';
    }

    onMounted(async ()=>{ await fetchConfig(); await loadPacks(); });
    return { name, packs, fileInput, upload, del, logout, onNav };
  }
}).use(ElementPlus).mount('#app');
