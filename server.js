const express = require('express');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

const configPath = path.join(__dirname, 'config.yml');
let config = { api_host: 'http://localhost', api_port: 3000, frontend_port: 4000 };
try {
  const doc = yaml.load(fs.readFileSync(configPath, 'utf8'));
  if (typeof doc === 'object') config = Object.assign(config, doc);
} catch (e) {
  // ignore, will use defaults
}

const apiBase = `${config.api_host.replace(/\/$/, '')}:${config.api_port}`;
const port = config.frontend_port || 4000;

// Same-origin API proxy to avoid browser CORS/preflight issues.
// Frontend should call `/api/...` and this server forwards to `apiBase`.
app.use(
  '/api',
  createProxyMiddleware({
    target: apiBase,
    changeOrigin: true,
    ws: true,
    secure: false,
    pathRewrite: (path) => {
      // Backend is mounted at /chats/... (not /api/chats), so strip /api prefix.
      // Also map our /api/socket.io -> backend /socket.io
      if (path.startsWith('/api/socket.io')) return path.replace('/api/socket.io', '/socket.io');
      return path.replace(/^\/api/, '');
    },
    cookieDomainRewrite: '',
    onError: (err, req, res) => {
      try {
        console.error('[proxy] error', err && err.message ? err.message : err);
      } catch (e) {}
      try {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad gateway', message: String(err && err.message ? err.message : err) }));
      } catch (e) {}
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (req, res) => {
  // `galleryImgBase` is optional. When provided, frontends can normalize image URLs.
  const galleryImgBase = config.gallery_img_base ? String(config.gallery_img_base) : undefined;
  res.json({ apiBase, apiProxyBase: '/api', galleryImgBase });
});

app.get('/health', (req, res) => res.json({ ok: true, apiBase }));

app.listen(port, () => {
  console.log(`Frontend running on http://localhost:${port}  — API: ${apiBase}`);
});
