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
    pathRewrite: { '^/api': '' },
    cookieDomainRewrite: '',
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (req, res) => {
  res.json({ apiBase, apiProxyBase: '/api' });
});

app.get('/health', (req, res) => res.json({ ok: true, apiBase }));

app.listen(port, () => {
  console.log(`Frontend running on http://localhost:${port}  — API: ${apiBase}`);
});
