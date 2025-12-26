let apiBase = '';
let token = localStorage.getItem('token') || null;

function $(id){ return document.getElementById(id); }

async function init(){
  const conf = await fetch('/config').then(r=>r.json());
  apiBase = conf.apiBase;
  setupSearch();
  loadUsers();
}

function setupSearch(){
  const input = $('userSearch');
  let timer = null;
  input.addEventListener('input', ()=>{
    clearTimeout(timer); timer = setTimeout(()=>{ renderUsers(filterUsers(input.value)); }, 150);
  });
}

let allUsers = [];
function filterUsers(q){
  if(!q) return allUsers.slice();
  const s = q.trim().toLowerCase();
  return allUsers.filter(u => (u.username||'').toLowerCase().includes(s) || (u.id||'').toLowerCase().includes(s));
}

async function loadUsers(){
  try{
    const res = await fetch(`${apiBase}/users`, { headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok) throw new Error('加载玩家失败');
    allUsers = await res.json();
    renderUsers(allUsers);
  }catch(e){ console.error(e); alert('无法加载玩家列表，请检查 API 配置和登录状态'); }
}

function renderUsers(list){
  const ul = $('userList'); ul.innerHTML = '';
  list.forEach(u => {
    const li = document.createElement('li');
    li.className = 'player';
    li.dataset.id = u.id;
    li.innerHTML = `<strong>${u.username || u.id}</strong><div class="meta">${u.id}</div>`;
    li.addEventListener('click', ()=>openOrCreateChat(u.id));
    ul.appendChild(li);
  });
}

async function openOrCreateChat(userId){
  try{
    const res = await fetch(`${apiBase}/chats/with/${encodeURIComponent(userId)}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok){ const txt = await res.text().catch(()=>''); throw new Error('无法打开/创建会话: ' + res.status + ' ' + txt); }
    const data = await res.json();
    const chatId = data.chatId || (data.chat && data.chat.id) || null;
    if(!chatId) throw new Error('无效的 chatId');
    // redirect to chat page and instruct it to open this chat
    window.location.href = `/chat.html?open=${encodeURIComponent(chatId)}`;
  }catch(e){ console.error(e); alert('打开或创建私聊失败'); }
}

document.addEventListener('DOMContentLoaded', ()=>{ init(); });
