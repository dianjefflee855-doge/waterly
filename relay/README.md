# Waterly Relay（自部署中继）

Waterly 没有官方服务器。想在手机上远程查看 Mac 上的会话，你需要把这个中继部署到**你自己的** Cloudflare 账号（免费套餐够用）。

中继只做两件事：按账号把 Mac 和手机放进同一个「房间」，转发**端到端加密后的密文**。它看不到聊天内容，也拿不到你的大模型 Key。

## 一键部署（推荐）

```bash
cd relay
./scripts/deploy.sh \
  --origin https://<你的网页端地址>   # 例如 https://you.github.io（只允许这个来源调用中继）
  # --domain relay.example.com       # 可选：绑定你在 Cloudflare 上的自定义域名
  # --registration-key               # 可选：设置注册密钥，防止陌生人用你的中继
```

脚本会：安装依赖 → `wrangler login`（浏览器授权你自己的账号）→ 可选设置 `REGISTRATION_KEY` → `wrangler deploy`。

部署完成后得到一个地址，例如 `https://waterly-relay.<你的子域>.workers.dev`。

## 手动部署

```bash
cd relay && npm install
npx wrangler login
npx wrangler secret put REGISTRATION_KEY      # 可选
npx wrangler deploy --var ALLOWED_ORIGINS:https://<你的网页端地址>
```

也可以在 Cloudflare 控制台 → Workers & Pages → Create → Import a repository，选你 fork 的仓库，根目录填 `relay`。

## 配置项（`wrangler.toml`）

| 名称 | 类型 | 说明 |
|---|---|---|
| `ALLOWED_ORIGINS` | 变量 | 允许调用中继的网页来源，逗号分隔。生产环境不要用 `*` |
| `DEVICE_TOKEN_TTL_DAYS` | 变量 | 手机设备令牌有效期，默认 30 天 |
| `PAIR_CODE_TTL_SEC` | 变量 | 配对码有效期，默认 300 秒 |
| `REGISTRATION_KEY` | Secret，可选 | 设置后，Mac 注册新账号必须带上同一个值 |
| Durable Objects | 绑定 | `ROOMS → Room`、`DIRECTORY → Directory`，迁移 `v1` |

## 把中继地址填到客户端

- **Mac 上的 Waterly**：「远程访问」→ 中继地址；设置了注册密钥的话，也填进「注册密钥」。
- **手机网页端**：打开页面 → 「连接 Mac」→「中继服务器」；或者用 `?relay=https://...`；或者自部署网页时在 HTML 的 `<meta name="waterly-relay" content="...">` 里写死。

## 本地开发与测试

```bash
npm install            # Node ≥ 22
npm test               # 自动起 wrangler dev，跑配对 / E2E / 吊销 / 隔离 / 重连
npx wrangler dev --port 8787
node mac-agent/agent.js --relay http://127.0.0.1:8787 --pair --demo   # 模拟 Mac，打印配对码
```

协议与安全设计见 [`docs/remote-relay-design.md`](../docs/remote-relay-design.md)。
