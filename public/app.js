let apiBase = '';
let token = localStorage.getItem('token') || null;
let currentChat = null;

function $(id){ return document.getElementById(id); }

async function init(){
  const conf = await fetch('/config').then(r=>r.json());
  apiBase = conf.apiBase;
  setupAuth();
  if (token) { showLoggedIn(); loadChats(); }
}

function setupAuth(){
  $('loginBtn').addEventListener('click', ()=>{
    const popup = window.open(`${apiBase}/auth/microsoft`, 'oauth', 'width=600,height=700');
    const timer = setInterval(()=>{
      try{
        if(!popup || popup.closed){ clearInterval(timer); return; }
        const txt = popup.document.body.innerText;
        if(txt){
          try{
            const data = JSON.parse(txt);
            if(data.token){
              token = data.token; localStorage.setItem('token', token);
              popup.close(); clearInterval(timer); showLoggedIn(); loadChats();
            }
          }catch(e){ /* ignore non-json */ }
        }
      }catch(e){ /* cross-origin until final redirect */ }
    }, 500);
  });

  $('logoutBtn').addEventListener('click', ()=>{
    token = null; localStorage.removeItem('token'); showLoggedOut();
  });

  $('applyToken').addEventListener('click', ()=>{
    const t = $('manualToken').value.trim();
    if(t){ token = t; localStorage.setItem('token', t); $('pasteToken').style.display='none'; showLoggedIn(); loadChats(); }
  });
}

function showLoggedIn(){
  $('loginBtn').style.display='none';
  $('logoutBtn').style.display='inline-block';
}
function showLoggedOut(){
  $('loginBtn').style.display='inline-block';
  $('logoutBtn').style.display='none';
  $('chatList').innerHTML=''; $('messages').innerHTML='';
}

async function loadChats(){
  try{
    const res = await fetch(`${apiBase}/chats`, { headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok) throw new Error('未登录或请求失败');
    const chats = await res.json();
    const ul = $('chatList'); ul.innerHTML='';
    chats.forEach(c=>{
      const li = document.createElement('li'); li.textContent = c.name || (c.members||[]).join(',');
      li.dataset.id = c.id; li.addEventListener('click', ()=>openChat(c.id)); ul.appendChild(li);
    });
  }catch(e){ console.error(e); alert('加载会话失败，请检查 API 配置并确保已登录'); }
}

async function openChat(id){
  currentChat = id;
  try{
    const res = await fetch(`${apiBase}/chats/${id}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
    if(!res.ok) throw new Error('加载消息失败');
    const msgs = await res.json();
    const cont = $('messages'); cont.innerHTML='';
    msgs.forEach(m=>{
      const d = document.createElement('div'); d.className='msg';
      d.innerHTML = `<b>${m.from}</b>: ${typeof m.content === 'object' ? JSON.stringify(m.content) : (m.content||'')}`;
      cont.appendChild(d);
    });
  }catch(e){ console.error(e); alert('无法打开会话，可能权限不足'); }
}

document.addEventListener('DOMContentLoaded', ()=>{
  init();
  const form = $('sendForm');
  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault(); if(!currentChat) return alert('先选择会话');
    const text = $('msgInput').value.trim(); if(!text) return;
    try{
      const res = await fetch(`${apiBase}/chats/${currentChat}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ type: 'text', content: text })
      });
      if(!res.ok) throw new Error('发送失败');
      $('msgInput').value=''; openChat(currentChat);
    }catch(e){ console.error(e); alert('发送消息失败'); }
  });
});
