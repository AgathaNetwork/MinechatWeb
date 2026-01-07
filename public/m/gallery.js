// Mobile gallery page
const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const apiBase = ref('');
    const apiAuthBase = ref('');
    const token = ref(localStorage.getItem('token') || null);

    const loading = ref(false);
    const loadingMore = ref(false);
    const loadError = ref('');

    const items = ref([]);
    const page = ref(1);
    const noMore = ref(false);

    const worldDict = ref([]);
    const typeDict = ref([]);

    const year = ref('');
    const world = ref(null);
    const type = ref(null);
    const q = ref('');

    const detailVisible = ref(false);
    const detailLoading = ref(false);
    const detailError = ref('');
    const detail = ref(null);

    const worldOptions = computed(() => {
      const list = Array.isArray(worldDict.value) ? worldDict.value : [];
      return list
        .map((x) => ({ value: x && x.id !== undefined ? Number(x.id) : null, label: x && x.name ? String(x.name) : '' }))
        .filter((x) => x.value !== null && x.label);
    });

    const typeOptions = computed(() => {
      const list = Array.isArray(typeDict.value) ? typeDict.value : [];
      return list
        .map((x) => ({ value: x && x.id !== undefined ? Number(x.id) : null, label: x && x.name ? String(x.name) : '' }))
        .filter((x) => x.value !== null && x.label);
    });

    function tokenValue() {
      const t = (token.value || '').trim();
      return t ? t : null;
    }

    function authHeaders(extra) {
      const h = Object.assign({}, extra || {});
      const t = tokenValue();
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({ credentials: 'include' }, options || {});
      opt.headers = authHeaders(opt.headers);
      return fetch(url, opt);
    }

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiAuthBase.value = conf.apiBase;
      apiBase.value = conf.apiProxyBase || conf.apiBase;
      return conf;
    }

    function ymdhmFromTs(v) {
      try {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return '-';
        const d = new Date(n);
        if (isNaN(d.getTime())) return '-';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${dd} ${hh}:${mm}`;
      } catch (e) {
        return '-';
      }
    }

    function worldNameFromId(id) {
      const list = Array.isArray(worldDict.value) ? worldDict.value : [];
      const it = list.find((x) => x && String(x.id) === String(id));
      return it && it.name ? String(it.name) : (id !== null && id !== undefined ? String(id) : '-');
    }

    function typeNameFromId(id) {
      const list = Array.isArray(typeDict.value) ? typeDict.value : [];
      const it = list.find((x) => x && String(x.id) === String(id));
      return it && it.name ? String(it.name) : (id !== null && id !== undefined ? String(id) : '-');
    }

    function normalizeImageUrl(rawUrl, imgBase) {
      const u = String(rawUrl || '').trim();
      if (!u) return '';

      const base = String(imgBase || '').trim().replace(/\/+$/, '');
      const hasAbsoluteBase = /^https?:\/\//i.test(base);

      if (/^https?:\/\//i.test(u)) {
        if (!hasAbsoluteBase) return u;
        try {
          const src = new URL(u);
          const dst = new URL(base);

          const knownOrigins = new Set([
            'https://api-gallery-img.agatha.org.cn',
            'https://api-gallery.agatha.org.cn',
          ]);
          if (!knownOrigins.has(src.origin)) return u;

          const dstPath = dst.pathname.replace(/\/+$/, '');
          let path = src.pathname || '/';
          if (!path.startsWith('/')) path = '/' + path;
          if (dstPath && path.startsWith(dstPath + '/')) {
            path = path.slice(dstPath.length);
          }
          return dst.origin + dstPath + path + (src.search || '') + (src.hash || '');
        } catch (e) {
          return u;
        }
      }

      if (!base) return u;
      if (u.startsWith('/')) return base + u;
      return base + '/' + u;
    }

    function getEffectiveImgBase(conf) {
      const fromConf = conf && (conf.galleryImgBase || conf.gallery_img_base);
      if (fromConf) return String(fromConf);
      return 'https://api-gallery-img.agatha.org.cn';
    }

    function buildListEndpoint(pageNum) {
      const p = Number(pageNum) || 1;
      const y = String(year.value || '').trim();
      const w = world.value !== null && world.value !== undefined && String(world.value).trim() !== '' ? Number(world.value) : null;
      const t = type.value !== null && type.value !== undefined && String(type.value).trim() !== '' ? Number(type.value) : null;
      const qq = String(q.value || '').trim();

      if (qq) return `${apiBase.value}/aggallery/getIndexByName?page=${encodeURIComponent(p)}&q=${encodeURIComponent(qq)}`;
      if (y) return `${apiBase.value}/aggallery/getIndexByYear?page=${encodeURIComponent(p)}&year=${encodeURIComponent(y)}`;
      if (w !== null && Number.isFinite(w)) return `${apiBase.value}/aggallery/getIndexByWorld?page=${encodeURIComponent(p)}&world=${encodeURIComponent(w)}`;
      if (t !== null && Number.isFinite(t)) return `${apiBase.value}/aggallery/getIndexByType?page=${encodeURIComponent(p)}&type=${encodeURIComponent(t)}`;
      return `${apiBase.value}/aggallery/getIndex?page=${encodeURIComponent(p)}`;
    }

    async function loadDicts() {
      try {
        const [wRes, tRes] = await Promise.all([
          safeFetch(`${apiBase.value}/aggallery/getWorldDict`),
          safeFetch(`${apiBase.value}/aggallery/getTypeDict`),
        ]);
        if (wRes.ok) worldDict.value = (await wRes.json().catch(() => [])) || [];
        if (tRes.ok) typeDict.value = (await tRes.json().catch(() => [])) || [];
      } catch (e) {}
    }

    async function loadPage(pageNum, append) {
      const p = Number(pageNum) || 1;
      if (!append) {
        loading.value = true;
        loadError.value = '';
      } else {
        loadingMore.value = true;
      }

      try {
        const conf = await fetchConfig();
        const imgBase = getEffectiveImgBase(conf);

        const url = buildListEndpoint(p);
        const res = await safeFetch(url);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`${res.status} ${txt}`);
        }
        const raw = await res.json().catch(() => []);
        const list = Array.isArray(raw) ? raw : [];

        const normalized = list.map((x) => {
          const id = x && x.id !== undefined ? x.id : null;
          const name = x && x.name ? String(x.name) : '';
          const uploader = x && x.uploader ? String(x.uploader) : '';
          const ts = x && (x.timestamp || x.time || x.createdAt) ? Number(x.timestamp || x.time || x.createdAt) : null;
          const yy = x && (x.year !== undefined && x.year !== null) ? String(x.year) : '';
          const w = x && (x.world !== undefined && x.world !== null) ? Number(x.world) : null;
          const t = x && (x.type !== undefined && x.type !== null) ? Number(x.type) : null;
          const annotation = x && x.annotation ? String(x.annotation) : '';
          const thumbUrl = normalizeImageUrl(x && x.url, imgBase);

          return {
            id,
            name,
            year: yy,
            world: w,
            type: t,
            worldName: worldNameFromId(w),
            typeName: typeNameFromId(t),
            annotation,
            uploaderText: uploader ? `上传者：${uploader}` : '上传者：- ',
            timeText: ts ? ymdhmFromTs(ts) : '-',
            thumbUrl,
          };
        });

        if (append) items.value = items.value.concat(normalized);
        else items.value = normalized;

        page.value = p;
        noMore.value = normalized.length < 5;
      } catch (e) {
        loadError.value = e && e.message ? e.message : String(e);
      } finally {
        loading.value = false;
        loadingMore.value = false;
      }
    }

    async function applyFilters() {
      noMore.value = false;
      await loadPage(1, false);
    }

    function resetFilters() {
      year.value = '';
      world.value = null;
      type.value = null;
      q.value = '';
      applyFilters();
    }

    async function loadMore() {
      if (loading.value || loadingMore.value || noMore.value) return;
      await loadPage((Number(page.value) || 1) + 1, true);
    }

    function safeJsonParse(v, fallback) {
      try {
        if (!v) return fallback;
        if (typeof v === 'object') return v;
        return JSON.parse(String(v));
      } catch (e) {
        return fallback;
      }
    }

    function buildMapUrl(pos) {
      try {
        if (!pos || typeof pos !== 'object') return '';
        const world = String(pos.world || '').trim();
        if (!world || world === 'none') return '';
        const x = Number(pos.x);
        const z = Number(pos.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return '';
        return `https://map.agatha.org.cn/#${encodeURIComponent(world)}:${encodeURIComponent(x)}:0:${encodeURIComponent(z)}:1500:0:0:0:0:perspective`;
      } catch (e) {
        return '';
      }
    }

    function kvRows(obj) {
      if (!obj || typeof obj !== 'object') return [];
      const rows = [];
      for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) continue;
        const vv = typeof v === 'string' ? v : JSON.stringify(v);
        rows.push({ k, v: vv });
      }
      return rows;
    }

    async function openDetail(it) {
      detailVisible.value = true;
      detailLoading.value = true;
      detailError.value = '';
      detail.value = null;

      try {
        const conf = await fetchConfig();
        const imgBase = getEffectiveImgBase(conf);

        const id = it && it.id !== undefined ? it.id : null;
        if (!id) throw new Error('无效 ID');
        const res = await safeFetch(`${apiBase.value}/aggallery/getDetail?id=${encodeURIComponent(id)}`);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`${res.status} ${txt}`);
        }
        const d = await res.json().catch(() => null);
        if (!d || typeof d !== 'object') throw new Error('返回数据异常');

        const players = safeJsonParse(d.players, []);
        const position = safeJsonParse(d.position, null);
        const shader = safeJsonParse(d.shader, null);
        const metadata = safeJsonParse(d.metadata, null);

        const mapUrl = buildMapUrl(position);
        const positionText = position && typeof position === 'object' && position.world && position.world !== 'none'
          ? `世界：${position.world}，X：${position.x}，Y：${position.y}，Z：${position.z}`
          : '';

        detail.value = {
          id: d.id,
          name: d.name ? String(d.name) : '',
          year: d.year !== undefined && d.year !== null ? String(d.year) : '',
          world: d.world !== undefined && d.world !== null ? Number(d.world) : null,
          type: d.type !== undefined && d.type !== null ? Number(d.type) : null,
          worldName: worldNameFromId(d.world),
          typeName: typeNameFromId(d.type),
          uploader: d.uploader ? String(d.uploader) : '',
          annotation: d.annotation ? String(d.annotation) : '',
          imageUrl: normalizeImageUrl(d.url, imgBase),
          players: Array.isArray(players) ? players.map((x) => String(x)).filter(Boolean) : [],
          position: mapUrl ? { mapUrl } : null,
          positionText,
          metadataRows: kvRows(metadata),
          shaderRows: kvRows(shader),
        };
      } catch (e) {
        detailError.value = e && e.message ? e.message : String(e);
      } finally {
        detailLoading.value = false;
      }
    }

    function setYear(v) {
      year.value = v ? String(v) : '';
      q.value = '';
      applyFilters();
    }

    function setWorld(v) {
      const n = Number(v);
      world.value = Number.isFinite(n) ? n : null;
      q.value = '';
      applyFilters();
    }

    function setType(v) {
      const n = Number(v);
      type.value = Number.isFinite(n) ? n : null;
      q.value = '';
      applyFilters();
    }

    onMounted(async () => {
      await fetchConfig();
      await loadDicts();
      await loadPage(1, false);
    });

    return {
      year,
      world,
      type,
      q,
      items,
      loading,
      loadingMore,
      loadError,
      noMore,
      worldOptions,
      typeOptions,
      applyFilters,
      resetFilters,
      loadMore,
      openDetail,
      detailVisible,
      detailLoading,
      detailError,
      detail,
      setYear,
      setWorld,
      setType,
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
