// Mobile emojis management page
const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    const apiBase = ref('');
    const token = ref(localStorage.getItem('token') || null);
    const packs = ref([]);
    const name = ref('');
    const selectedFile = ref(null);
    const fileInput = ref(null);

    async function fetchConfig() {
      const conf = await fetch('/config').then((r) => r.json());
      apiBase.value = conf.apiBase || '';
    }

    function authHeaders() {
      const h = {};
      const t = token.value;
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    }

    async function safeFetch(url, options) {
      const opt = Object.assign({}, options || {});
      opt.headers = authHeaders();
      // 只在没有 token 时才使用 credentials（依赖 cookie）
      if (!token.value) {
        opt.credentials = 'include';
      }
      return fetch(url, opt);
    }

    async function loadPacks() {
      try {
        const res = await safeFetch(`${apiBase.value}/emoji-packs`);
        if (!res.ok) return;
        const data = await res.json();
        packs.value = data.map(p => ({
          ...p,
          url: p.url || `${apiBase.value}/emoji-packs/${p.id}/download`,
        }));
      } catch (e) {}
    }

    function selectFile() {
      fileInput.value?.click();
    }

    function onFileChange(e) {
      const files = e.target?.files;
      if (files && files.length > 0) {
        selectedFile.value = files[0];
      }
    }

    async function upload() {
      if (!selectedFile.value) return;

      try {
        const form = new FormData();
        form.append('file', selectedFile.value);
        if (name.value) form.append('name', name.value);

        const headers = authHeaders();
        delete headers['Content-Type'];

        const fetchOpts = {
          method: 'POST',
          headers,
          body: form,
        };
        // 只在没有 token 时才使用 credentials（依赖 cookie）
        if (!token.value) {
          fetchOpts.credentials = 'include';
        }
        const res = await fetch(`${apiBase.value}/emoji-packs`, fetchOpts);

        if (!res.ok) throw new Error('上传失败');

        ElementPlus.ElMessage.success('上传成功');
        name.value = '';
        selectedFile.value = null;
        if (fileInput.value) fileInput.value.value = '';
        await loadPacks();
      } catch (e) {
        ElementPlus.ElMessage.error(e.message || '上传失败');
      }
    }

    async function del(id) {
      try {
        await ElementPlus.ElMessageBox.confirm('确定要删除这个表情包吗？', '确认删除', {
          type: 'warning',
        });

        const res = await safeFetch(`${apiBase.value}/emoji-packs/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });

        if (!res.ok) throw new Error('删除失败');

        ElementPlus.ElMessage.success('删除成功');
        await loadPacks();
      } catch (e) {
        if (e !== 'cancel') {
          ElementPlus.ElMessage.error(e.message || '删除失败');
        }
      }
    }

    function goBack() {
      window.history.back();
    }

    onMounted(async () => {
      await fetchConfig();
      await loadPacks();
    });

    return {
      packs,
      name,
      selectedFile,
      fileInput,
      selectFile,
      onFileChange,
      upload,
      del,
      goBack,
    };
  },
}).use(ElementPlus).mount('#app');
