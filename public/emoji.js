// Vue 3 emoji management page
const { createApp, ref, onMounted } = Vue;

createApp({
  setup(){
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const name = ref('');
    const packs = ref([]);
    const fileInput = ref(null);

    async function fetchConfig(){ const conf = await fetch('/config').then(r=>r.json()); apiBase.value = conf.apiProxyBase || conf.apiBase; }
    async function loadPacks(){
      try{ const r = await fetch(`${apiBase.value}/emoji`, { headers:{ 'Authorization': `Bearer ${token.value}` } }); if(r.ok) packs.value = await r.json(); }catch(e){ console.error(e); }
    }

    async function upload(){
      const fileEl = fileInput.value; if(!fileEl || !fileEl.files || !fileEl.files[0]) return alert('请选择文件');
      const f = fileEl.files[0]; const fd = new FormData(); fd.append('file', f); if(name.value) fd.append('name', name.value);
      try{ const r = await fetch(`${apiBase.value}/emoji`, { method:'POST', headers:{ 'Authorization': `Bearer ${token.value}` }, body: fd }); if(!r.ok) throw new Error('upload failed'); name.value=''; fileEl.value=''; await loadPacks(); }catch(e){ console.error(e); alert('上传失败'); }
    }

    async function del(id){ if(!confirm('删除该表情包？')) return; try{ const r = await fetch(`${apiBase.value}/emoji/${encodeURIComponent(id)}`, { method:'DELETE', headers:{ 'Authorization': `Bearer ${token.value}` } }); if(!r.ok) throw new Error('delete failed'); await loadPacks(); }catch(e){ console.error(e); alert('删除失败'); } }

    function logout(){ token.value=null; localStorage.removeItem('token'); window.location.href = '/'; }

    function onNav(key){
      if(key === 'chat') window.location.href = '/chat.html';
      else if(key === 'players') window.location.href = '/players.html';
    }

    onMounted(async ()=>{ await fetchConfig(); await loadPacks(); });
    return { name, packs, fileInput, upload, del, logout, onNav };
  }
}).use(ElementPlus).mount('#app');
