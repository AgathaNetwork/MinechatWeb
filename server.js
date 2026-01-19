const express = require('express');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const http = require('http');

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

// 反代API
// 简单请求日志，便于调试是否有到达本地代理
app.use((req, res, next) => {
  try { console.log('[proxy] incoming', req.method, req.url); } catch (e) {}
  next();
});

app.use(
  '/api',
  createProxyMiddleware({
    target: apiBase,
    changeOrigin: true,
    ws: true,
    secure: false,
    logLevel: 'debug',
    pathRewrite: (path) => {
      // support socket.io and notify paths explicitly
      if (path.startsWith('/api/socket.io')) return path.replace('/api/socket.io', '/socket.io');
      if (path.startsWith('/api/notify')) return path.replace('/api/notify', '/notify');
      return path.replace(/^\/api/, '');
    },
    cookieDomainRewrite: '',
    onProxyReq: (proxyReq, req, res) => {
      try { console.debug('[proxy] onProxyReq', req.method, req.url); } catch (e) {}
    },
    onProxyReqWs: (proxyReq, req, socket, options, head) => {
      try { console.debug('[proxy] onProxyReqWs upgrade', req.url); } catch (e) {}
    },
    onProxyRes: (proxyRes, req, res) => {
      try { console.debug('[proxy] onProxyRes', req.method, req.url, proxyRes.statusCode); } catch (e) {}
    },
    onError: (err, req, res) => {
      try {
        console.error('[proxy] error', err && err.message ? err.message : err);
      } catch (e) {}
      try {
        if (res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bad gateway', message: String(err && err.message ? err.message : err) }));
        }
      } catch (e) {}
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (req, res) => {
  res.json({ apiBase, apiProxyBase: '/api' });
});

app.get('/health', (req, res) => res.json({ ok: true, apiBase }));

const server = http.createServer(app);

// 记录 upgrade 事件，帮助调试 WebSocket 升级请求
server.on('upgrade', (req, socket, head) => {
  try { console.log('[proxy] upgrade', req.url); } catch (e) {}
});

server.listen(port, () => {
  console.log(`Frontend running on http://localhost:${port}  — API: ${apiBase}`);
});
