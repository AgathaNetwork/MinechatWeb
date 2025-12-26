let apiBase = '';
let token = localStorage.getItem('token') || null;
function $(id){ return document.getElementById(id); }
async function init(){
  const conf = await fetch('/config').then(r=>r.json()); apiBase = conf.apiBase;
  setupAuth();
  loadPacks();
  const form = $('uploadForm'); form.addEventListener('submit', async e=>{
    e.preventDefault(); const file = $('packFile').files[0]; if(!file) return alert('请选择文件');
    const name = $('packName').value.trim();
    const fd = new FormData(); fd.append('file', file); if(name) fd.append('name', name);
    try{
      const res = await fetch(`${apiBase}/emoji`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd });
      if(!res.ok) throw new Error('上传失败');
      await loadPacks(); $('packName').value=''; $('packFile').value='';
    }catch(e){ console.error(e); alert('上传失败'); }
  });
}

function setupAuth(){
  $('logoutBtn')?.addEventListener('click', ()=>{ token=null; localStorage.removeItem('token'); window.location.href='/'; });
}

async function loadPacks(){
  try{
    const res = await fetch(`${apiBase}/emoji`, { headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok) throw new Error('加载失败');
    const packs = await res.json();
    renderPacks(packs || []);
  }catch(e){ console.error(e); alert('无法加载表情包'); }
}

function renderPacks(packs){
  const container = $('packs'); container.innerHTML='';
  packs.forEach(p=>{
    const div = document.createElement('div'); div.style.width='120px'; div.style.textAlign='center';
    const img = document.createElement('img'); img.src = p.url; img.style.maxWidth='100%'; img.style.height='80px'; img.style.objectFit='contain';
    const name = document.createElement('div'); name.textContent = p.name || p.id; name.style.fontSize='12px'; name.style.marginTop='6px';
    const del = document.createElement('button'); del.textContent='删除'; del.style.marginTop='6px'; del.addEventListener('click', async ()=>{
      if(!confirm('删除该表情包？')) return;
      try{
        const r = await fetch(`${apiBase}/emoji/${encodeURIComponent(p.id)}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        if(!r.ok) throw new Error('删除失败');
        await loadPacks();
      }catch(e){ console.error(e); alert('删除失败（后端可能不支持 DELETE /emoji/:id）'); }
    });
    div.appendChild(img); div.appendChild(name); div.appendChild(del);
    container.appendChild(div);
  });
}

document.addEventListener('DOMContentLoaded', ()=>init());
