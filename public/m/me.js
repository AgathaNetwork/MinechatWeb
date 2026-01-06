// Mobile me page
const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const sessionOk = ref(false);
    const isLoggedIn = computed(() => !!tokenValue() || !!sessionOk.value);
    const loading = ref(false);
    const selfUserId = ref('');
    const selfUsername = ref('');
    const selfFaceUrl = ref('');
    const selfMinecraftUuid = ref('');
    const selfLevel = ref(null);
    const selfRegisteredAt = ref('');
    const selfLastLoginAt = ref('');
    const selfOnline = ref(null);
    const updating = ref(false);
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

    // Game services: Home query
    const homeDialogVisible = ref(false);
    const homeLoading = ref(false);
    const homeError = ref('');
    const homeNameQuery = ref('');
    const homeWorldFilter = ref(''); // '', 'world', 'world_nether', 'world_the_end'
    const homesList = ref([]); // [{ name, worldKey, worldLabel, x, y, z, yaw, pitch }]

    function isVanillaWorldKey(v) {
      const s = String(v || '').trim();
      return s === 'world' || s === 'world_nether' || s === 'world_the_end';
    }

    function worldLabelFromKey(k) {
      const key = String(k || '').trim();
      if (key === 'world') return '主世界';
      if (key === 'world_nether') return '下界';
      if (key === 'world_the_end') return '末地';
      return key || '-';
    }

    const filteredHomes = computed(() => {
      try {
        const nameQ = String(homeNameQuery.value || '').trim().toLowerCase();
        const worldQ = String(homeWorldFilter.value || '').trim();
        const list = Array.isArray(homesList.value) ? homesList.value : [];
        return list.filter((h) => {
          const nameOk = !nameQ || String(h.name || '').toLowerCase().includes(nameQ);
          const worldOk = !worldQ || String(h.worldKey || '') === worldQ;
          return nameOk && worldOk;
        });
      } catch (e) {
        return homesList.value || [];
      }
    });

    const selfDisplayName = computed(() => selfUsername.value || selfUserId.value || '未登录');
    const selfIdHint = computed(() => {
      const uuid = (selfMinecraftUuid.value || '').trim();
      return uuid ? uuid : '';
    });
    const selfInitial = computed(() => {
      const name = selfUsername.value || selfUserId.value || '?';
      return name.charAt(0).toUpperCase();
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

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiProxyBase || conf.apiBase || '';
    }

    function authHeaders() {
      const h = {};
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({}, options || {});
      opt.headers = Object.assign({}, opt.headers || {}, authHeaders());
      // 同源反代下始终带上 cookie，兼容仅 cookie/session 鉴权
      opt.credentials = 'include';

      const res = await fetch(url, opt);
      if (res.status === 401) {
        let txt = '';
        try {
          txt = await res.clone().text();
        } catch (e) {}
        if (/invalid token/i.test(txt)) {
          clearBadToken();
        }
      }
      return res;
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

    async function loadSelf() {
      if (loading.value) return;
      loading.value = true;
      try {
        await checkSession();

        // Prefer /users/me (desktop-compatible)
        let res = await safeFetch(`${apiBase.value}/users/me`);
        if (!res.ok && res.status === 404) {
          // Fallback for older backend
          res = await safeFetch(`${apiBase.value}/me`);
        }
        if (!res.ok) return;
        const me = await res.json().catch(() => null);
        if (!me || typeof me !== 'object') return;

        const id = me.id || me.userId || me.uid;
        selfUserId.value = id !== undefined && id !== null ? String(id) : '';
        selfUsername.value = me.username || me.displayName || me.name || '';
        const face = me.faceUrl || me.face_url || me.face;
        if (face) selfFaceUrl.value = String(face);

        const uuid = extractMinecraftUuid(me);
        if (uuid) selfMinecraftUuid.value = uuid;

        const created = extractCreatedAt(me);
        if (created) selfRegisteredAt.value = created;

        // If backend doesn't return username, try resolve from token + /users list
        if (!selfUsername.value) {
          const t = tokenValue();
          const payload = t ? decodeJwtPayload(t) : null;
          const meId = payload && (payload.userId || payload.uid || payload.id || payload.sub);
          if (meId) {
            const listRes = await safeFetch(`${apiBase.value}/users`);
            if (listRes.ok) {
              const list = await listRes.json().catch(() => null);
              if (Array.isArray(list)) {
                const u = list.find(x => x && String(x.id) === String(meId));
                if (u) {
                  selfUsername.value = u.username || u.displayName || selfUsername.value;
                  const f = u.faceUrl || u.face_url || u.face;
                  if (f && !selfFaceUrl.value) selfFaceUrl.value = String(f);

                  const uuid2 = extractMinecraftUuid(u);
                  if (uuid2 && !selfMinecraftUuid.value) selfMinecraftUuid.value = uuid2;

                  const created2 = extractCreatedAt(u);
                  if (created2 && !selfRegisteredAt.value) selfRegisteredAt.value = created2;
                }
              }
            }
          }
        }

        // extra info from /info (best effort)
        try {
          const r1 = await safeFetch(`${apiBase.value}/info/getPlayerData`);
          if (r1.ok) {
            const data = await r1.json().catch(() => null);
            if (data && typeof data === 'object') {
              if (data.level !== undefined && data.level !== null && String(data.level).trim()) {
                const n = Number(data.level);
                selfLevel.value = Number.isNaN(n) ? data.level : n;
              }

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
              }
            }
          }
        } catch (e) {}

        try {
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
        } catch (e) {}
      } catch (e) {}
      finally {
        loading.value = false;
      }
    }

    async function updateFace() {
      lastResult.value = '';
      lastError.value = '';
      updating.value = true;

      try {
        // Desktop-compatible endpoint
        let res = await safeFetch(`${apiBase.value}/users/me/face`, { method: 'POST' });
        if (!res.ok && res.status === 404) {
          // Fallback for older backend
          res = await safeFetch(`${apiBase.value}/me/update-face`, { method: 'POST' });
        }

        if (!res.ok) {
          const err = await res.text();
          throw new Error(err || '更新失败');
        }

        const data = await res.json().catch(() => null);
        if (data && typeof data === 'object') {
          const url = data.url || data.faceUrl || data.face_url || '';
          if (url) selfFaceUrl.value = String(url);
        }
        lastResult.value = '头像更新成功';
        
        await loadSelf();
        ElementPlus.ElMessage.success('头像更新成功');
      } catch (e) {
        lastError.value = e.message || '更新失败';
        ElementPlus.ElMessage.error(lastError.value);
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

    function normalizeWorldKeyFromHome(homeObj) {
      try {
        if (!homeObj || typeof homeObj !== 'object') return '';
        const wn = homeObj['world-name'] || homeObj.world_name || homeObj.worldName || '';
        if (isVanillaWorldKey(wn)) return String(wn).trim();
        const w = homeObj.world || '';
        if (isVanillaWorldKey(w)) return String(w).trim();
        const s1 = String(wn || '').trim();
        if (s1) return s1;
        return String(w || '').trim();
      } catch (e) {
        return '';
      }
    }

    function parseHomesFromPlayerData(data) {
      try {
        const homesRoot = data && typeof data === 'object' ? data.homes : null;
        const homesObj = homesRoot && typeof homesRoot === 'object' ? homesRoot.homes : null;
        if (!homesObj || typeof homesObj !== 'object') return [];

        const entries = Object.entries(homesObj).filter(([k, v]) => k && v && typeof v === 'object');
        return entries
          .map(([name, h]) => {
            const worldKey = normalizeWorldKeyFromHome(h);
            const x = h.x;
            const y = h.y;
            const z = h.z;

            const xNum = Number(x);
            const yNum = Number(y);
            const zNum = Number(z);
            return {
              name: String(name),
              worldKey: worldKey || '',
              worldLabel: worldLabelFromKey(worldKey),
              x: Number.isFinite(xNum) ? String(Math.round(xNum)) : x === undefined || x === null ? '' : String(x),
              y: Number.isFinite(yNum) ? String(Math.round(yNum)) : y === undefined || y === null ? '' : String(y),
              z: Number.isFinite(zNum) ? String(Math.round(zNum)) : z === undefined || z === null ? '' : String(z),
            };
          })
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      } catch (e) {
        return [];
      }
    }

    function openHomeDialog() {
      homeDialogVisible.value = true;
      homeError.value = '';
      homeNameQuery.value = '';
      homeWorldFilter.value = '';
      homesList.value = [];
      if (isLoggedIn.value) runHomeQuery();
      else ElementPlus.ElMessage.warning('请先登录');
    }

    async function runHomeQuery() {
      if (homeLoading.value) return;
      homeLoading.value = true;
      homeError.value = '';
      homesList.value = [];
      try {
        const res = await safeFetch(`${apiBase.value}/info/getPlayerData`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => null);
        homesList.value = parseHomesFromPlayerData(data);
      } catch (e) {
        homeError.value = e && e.message ? e.message : String(e);
      } finally {
        homeLoading.value = false;
      }
    }

    async function logout() {
      try {
        await safeFetch(`${apiBase.value}/auth/logout`, { method: 'POST' });
      } catch (e) {}
      
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        localStorage.removeItem('faceUrl');
      } catch (e) {}
      
      window.location.href = '/';
    }

    function goEmojiManage() {
      window.location.href = '/m/emojis.html';
    }

    function gotoInfo() {
      window.location.href = '/m/info.html';
    }

    onMounted(async () => {
      await fetchConfig();
      await loadSelf();
    });

    return {
      isLoggedIn,
      loading,
      selfDisplayName,
      selfIdHint,
      selfInitial,
      selfFaceUrl,
      selfMinecraftUuid,
      selfLevel,
      selfRegisterHint,
      selfLastLoginHint,
      selfOnline,
      selfOnlineDisplay,
      profileRows,
      updating,
      lastResult,
      lastError,
      updateFace,
      logout,
      goEmojiManage,
      gotoInfo,

      // account dialogs
      idDialogVisible,
      idLoading,
      idRows,
      idError,
      openIdDialog,
      runIdQuery,

      historyDialogVisible,
      historyLoading,
      historyList,
      historyError,
      openHistoryDialog,
      runHistoryQuery,

      // game services
      homeDialogVisible,
      homeLoading,
      homeError,
      homeNameQuery,
      homeWorldFilter,
      filteredHomes,
      openHomeDialog,
      runHomeQuery,
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
