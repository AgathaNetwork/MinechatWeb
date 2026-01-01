// Vue 3 + Element Plus "Me" page
const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');

    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);

    const loading = ref(false);
    const updating = ref(false);

    const selfUserId = ref('');
    const selfUsername = ref('');
    const selfFaceUrl = ref('');
    const selfMinecraftUuid = ref('');

    const selfLevel = ref(null);
    const selfRegisteredAt = ref('');
    const selfLastLoginAt = ref('');
    const selfOnline = ref(null);

    const lastResult = ref('');
    const lastError = ref('');

    const idDialogVisible = ref(false);
    const idLoading = ref(false);
    const idDocName = ref('');
    const idDocNumber = ref('');
    const idError = ref('');

    const idRows = computed(() => {
      return [
        { k: '证件姓名', v: idDocName.value || '-' },
        { k: '证件号码', v: idDocNumber.value || '-' },
      ];
    });

    const historyDialogVisible = ref(false);
    const historyLoading = ref(false);
    const historyList = ref([]);
    const historyError = ref('');

    const isLoggedIn = computed(() => !!tokenValue() || !!sessionOk.value);

    const selfDisplayName = computed(() => {
      if (selfUsername.value) return selfUsername.value;
      if (selfUserId.value) return selfUserId.value;
      return '未识别用户';
    });

    const selfInitial = computed(() => {
      const s = selfUsername.value || selfUserId.value || '?';
      return String(s).slice(0, 1).toUpperCase();
    });

    const selfIdHint = computed(() => {
      const uuid = (selfMinecraftUuid.value || '').trim();
      if (!uuid) return '';
      return uuid;
    });

    const selfRegisterHint = computed(() => {
      const v = (selfRegisteredAt.value || '').trim();
      if (!v) return '';
      const dt = parseDate(v);
      if (!dt) return '';
      return formatYmd(dt);
    });

    const selfLastLoginHint = computed(() => {
      const v = (selfLastLoginAt.value || '').trim();
      if (!v) return '';
      const dt = parseDate(v);
      if (!dt) return '';
      return formatYmdHm(dt);
    });

    const selfOnlineDisplay = computed(() => {
      // 按需求：不显示“未知”，未知时当作离线
      return !!selfOnline.value;
    });

    const profileRows = computed(() => {
      const levelText = selfLevel.value === null || selfLevel.value === undefined || selfLevel.value === '' ? '-' : String(selfLevel.value);
      return [
        { k: '等级', v: levelText },
        { k: '注册时间', v: selfRegisterHint.value || '-' },
        { k: '上次上线', v: selfLastLoginHint.value || '-' },
      ];
    });

    function parseDate(v) {
      try {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') {
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        }
        const s = String(v).trim();
        if (!s) return null;
        const n = Number(s);
        if (!Number.isNaN(n) && n > 0 && s.length >= 10) {
          const d = new Date(n);
          if (!isNaN(d.getTime())) return d;
        }
        const d2 = new Date(s);
        return isNaN(d2.getTime()) ? null : d2;
      } catch (e) {
        return null;
      }
    }

    function formatYmd(d) {
      try {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      } catch (e) {
        return '';
      }
    }

    function formatYmdHm(d) {
      try {
        const ymd = formatYmd(d);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return ymd ? `${ymd} ${hh}:${mm}` : '';
      } catch (e) {
        return '';
      }
    }

    function extractMinecraftUuid(obj) {
      try {
        if (!obj || typeof obj !== 'object') return '';
        const candidates = [
          obj.minecraftUuid,
          obj.minecraft_uuid,
          obj.minecraftUUID,
          obj.mcUuid,
          obj.mc_uuid,
          obj.uuid,
        ];
        for (const c of candidates) {
          if (c !== undefined && c !== null && String(c).trim()) return String(c).trim();
        }
        return '';
      } catch (e) {
        return '';
      }
    }

    function extractCreatedAt(obj) {
      try {
        if (!obj || typeof obj !== 'object') return '';
        const candidates = [
          obj.createdAt,
          obj.created_at,
          obj.createTime,
          obj.create_time,
          obj.registeredAt,
          obj.registered_at,
          obj.regTime,
          obj.reg_time,
        ];
        for (const c of candidates) {
          if (c !== undefined && c !== null && String(c).trim()) return String(c).trim();
        }
        return '';
      } catch (e) {
        return '';
      }
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

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
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

    async function tryLoadSelfFromMe() {
      try {
        const res = await safeFetch(`${apiBase.value}/users/me`);
        if (!res.ok) return false;
        const me = await res.json().catch(() => null);
        if (!me || typeof me !== 'object') return false;

        const id = me.id || me.userId || me.uid;
        if (id !== undefined && id !== null) selfUserId.value = String(id);
        selfUsername.value = me.username || me.displayName || selfUsername.value;

        const face = me.faceUrl || me.face_url || me.face;
        if (face) selfFaceUrl.value = String(face);

        const uuid = extractMinecraftUuid(me);
        if (uuid) selfMinecraftUuid.value = uuid;

        const created = extractCreatedAt(me);
        if (created) selfRegisteredAt.value = created;

        return true;
      } catch (e) {
        return false;
      }
    }

    async function tryLoadSelfFromUsersList() {
      const t = tokenValue();
      if (!t) return false;
      const payload = decodeJwtPayload(t);
      const meId = payload && (payload.userId || payload.uid || payload.id || payload.sub);
      if (!meId) return false;

      try {
        const res = await safeFetch(`${apiBase.value}/users`);
        if (!res.ok) return false;
        const list = await res.json().catch(() => null);
        if (!Array.isArray(list)) return false;
        const u = list.find((x) => x && String(x.id) === String(meId));
        if (!u) return false;

        selfUserId.value = String(u.id);
        selfUsername.value = u.username || u.displayName || selfUsername.value;
        const face = u.faceUrl || u.face_url || u.face;
        if (face) selfFaceUrl.value = String(face);

        const uuid = extractMinecraftUuid(u);
        if (uuid) selfMinecraftUuid.value = uuid;

        const created = extractCreatedAt(u);
        if (created) selfRegisteredAt.value = created;
        return true;
      } catch (e) {
        return false;
      }
    }

    async function tryLoadExtraFromInfo() {
      try {
        if (!apiBase.value) return;
        if (!isLoggedIn.value) return;

        // Level / playerName
        const r1 = await safeFetch(`${apiBase.value}/info/getPlayerData`);
        if (r1.ok) {
          const data = await r1.json().catch(() => null);
          if (data && typeof data === 'object') {
            if (data.level !== undefined && data.level !== null && String(data.level).trim()) {
              const n = Number(data.level);
              selfLevel.value = Number.isNaN(n) ? data.level : n;
            }
            const pn = data.playerName || data.username;
            if (pn && !selfUsername.value) selfUsername.value = String(pn);

            // authme: 注册时间/上次上线/在线状态
            const auth = data.authme;
            if (auth && typeof auth === 'object') {
              if (auth.regdate !== undefined && auth.regdate !== null && String(auth.regdate).trim()) {
                selfRegisteredAt.value = String(auth.regdate).trim();
              }
              if (auth.lastlogin !== undefined && auth.lastlogin !== null && String(auth.lastlogin).trim()) {
                selfLastLoginAt.value = String(auth.lastlogin).trim();
              }
              if (auth.isLogged !== undefined && auth.isLogged !== null && String(auth.isLogged).trim()) {
                const v = String(auth.isLogged).trim();
                selfOnline.value = v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'online';
              }
              // 有些库返回 realname
              const rn = auth.realname;
              if (rn && !selfUsername.value) selfUsername.value = String(rn);
            }
          }
        }

        // Online status list (best effort)
        if (selfOnline.value === null) {
          const r2 = await safeFetch(`${apiBase.value}/info/getOnlineStatus`);
          if (r2.ok) {
            const data2 = await r2.json().catch(() => null);
            const list = data2 && typeof data2 === 'object' && Array.isArray(data2.list) ? data2.list : null;
            if (list && list.length) {
              const key = String(selfUsername.value || '').trim();
              if (key) {
                const row = list.find((x) => x && String(x.realname || x.name || x.username || '').trim().toLowerCase() === key.toLowerCase());
                if (row) {
                  const v = row.isLogged;
                  selfOnline.value = String(v).trim() === '1' || String(v).trim().toLowerCase() === 'true' || String(v).trim().toLowerCase() === 'online';
                }
              }
            }
          }
        }
      } catch (e) {
        // best-effort only
      }
    }

    async function reloadSelf() {
      if (loading.value || updating.value) return;
      loading.value = true;
      lastError.value = '';
      try {
        await checkSession();
        const ok = (await tryLoadSelfFromMe()) || (await tryLoadSelfFromUsersList());
        if (!ok) {
          // best-effort only; keep page usable
        }

        await tryLoadExtraFromInfo();
      } finally {
        loading.value = false;
      }
    }

    async function updateFace() {
      if (updating.value || loading.value) return;
      updating.value = true;
      lastResult.value = '';
      lastError.value = '';
      try {
        const res = await safeFetch(`${apiBase.value}/users/me/face`, { method: 'POST' });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object') {
          const url = data.url || data.faceUrl || data.face_url || '';
          if (url) selfFaceUrl.value = String(url);
          lastResult.value = '头像更新成功';
        } else {
          lastResult.value = '头像更新成功';
        }
        ElementPlus.ElMessage.success('已触发更新');
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        lastError.value = msg;
        ElementPlus.ElMessage.error('更新失败');
      } finally {
        updating.value = false;
      }
    }

    function openIdDialog() {
      idDialogVisible.value = true;
      idError.value = '';
      idDocName.value = '';
      idDocNumber.value = '';
      if (isLoggedIn.value) runIdQuery();
      else ElementPlus.ElMessage.warning('请先登录');
    }

    async function runIdQuery() {
      if (idLoading.value) return;
      idLoading.value = true;
      idError.value = '';
      idDocName.value = '';
      idDocNumber.value = '';
      try {
        const res = await safeFetch(`${apiBase.value}/info/getId`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        const name = data && typeof data === 'object' ? (data.realname || data.name || '') : '';
        const id = data && typeof data === 'object' ? (data.id || data.card || data.idcard || '') : '';
        if (name) idDocName.value = String(name);
        if (id) idDocNumber.value = String(id);
      } catch (e) {
        idError.value = e && e.message ? e.message : String(e);
      } finally {
        idLoading.value = false;
      }
    }

    function openHistoryDialog() {
      historyDialogVisible.value = true;
      historyError.value = '';
      historyList.value = [];
      if (isLoggedIn.value) runHistoryQuery();
      else ElementPlus.ElMessage.warning('请先登录');
    }

    async function runHistoryQuery() {
      if (historyLoading.value) return;
      historyLoading.value = true;
      historyError.value = '';
      historyList.value = [];
      try {
        // Backend endpoint: /users/me/login-history
        let res = await safeFetch(`${apiBase.value}/users/me/login-history`);
        if (!res.ok && res.status === 404) {
          // Backward-compatible fallback (old Minechat /info API)
          res = await safeFetch(`${apiBase.value}/info/getLoginHistory`);
        }

        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }

        const data = await res.json().catch(() => null);
        const rawHistory = data && typeof data === 'object' && Array.isArray(data.history) ? data.history : [];
        historyList.value = rawHistory.map((r) => {
          const ip = r && typeof r === 'object' ? (r.ip || r.IP || r.addr || '') : '';
          const t = r && typeof r === 'object' ? (r.time || r.created_at || r.createdAt || '') : '';
          const dt = parseDate(t);
          return {
            time: dt ? formatYmdHm(dt) : (t ? String(t) : '-'),
            ip: ip ? String(ip) : '-',
          };
        });
      } catch (e) {
        historyError.value = e && e.message ? e.message : String(e);
      } finally {
        historyLoading.value = false;
      }
    }

    function onNav(key) {
      if (key === 'chat') window.location.href = '/chat.html';
      else if (key === 'players') window.location.href = '/players.html';
      else if (key === 'me') window.location.href = '/me.html';
    }

    function gotoLogin() {
      window.location.href = '/';
    }
    
      function gotoInfo() {
        window.location.href = '/info.html';
      }

    async function logout() {
      token.value = null;
      try {
        localStorage.removeItem('token');
      } catch (e) {}
      sessionOk.value = false;
      try {
        const base = apiAuthBase.value || apiBase.value;
        fetch(`${base}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
      } catch (e) {}
      window.location.href = '/';
    }

    onMounted(async () => {
      await fetchConfig();
      await reloadSelf();
    });

    return {
      // state
      loading,
      updating,
      isLoggedIn,
      selfUserId,
      selfUsername,
      selfFaceUrl,
      selfMinecraftUuid,
      selfLevel,
      selfRegisteredAt,
      selfRegisterHint,
      selfLastLoginAt,
      selfLastLoginHint,
      selfOnline,
      selfOnlineDisplay,
      profileRows,
      selfDisplayName,
      selfInitial,
      selfIdHint,
      lastResult,
      lastError,

      // account dialogs
      idDialogVisible,
      idLoading,
      idRows,
      idError,
      historyDialogVisible,
      historyLoading,
      historyList,
      historyError,

      // actions
      onNav,
      gotoLogin,
      gotoInfo,
      logout,
      reloadSelf,
      updateFace,

      openIdDialog,
      runIdQuery,
      openHistoryDialog,
      runHistoryQuery,
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
