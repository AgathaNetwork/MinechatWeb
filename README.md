# Minechat 前端（Node.js + Express）

快速启动说明：

1. 编辑 `config.yml`，将 `api_host` 和 `api_port` 配置为你的后端 API 地址与端口（例如 `http://localhost` 和 `3000`）。
2. 安装依赖并启动：

```bash
npm install
npm start
```

3. 打开浏览器访问 `http://localhost:4000`（或你在 `config.yml` 中配置的 `frontend_port`）。

登录说明：
- 点击“使用 Microsoft 登录”会打开后端的 OAuth 开始地址（`/auth/microsoft`）。后端完成回调后会在弹窗内显示一个 JSON 包含 `token`，前端会尝试自动读取并保存该 token 到 `localStorage`。如果弹窗无法自动完成，请复制 JSON 中的 `token` 并在页面中手动粘贴。

API 路径假设：
- 登录入口：`${api_base}/auth/microsoft`
- 获取会话：`${api_base}/chats` （GET）
- 获取消息：`${api_base}/chats/{chatId}/messages` （GET）
- 发送消息：`${api_base}/chats/{chatId}/messages` （POST，JSON body）

如果你的后端路由前缀或结构不同，请调整 `config.yml` 或后端以匹配。
