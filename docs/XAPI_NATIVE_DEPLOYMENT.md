# Kanby 经 xAPI 部署：原生基线与执行记录

更新：2026-09-15。**状态：完整应用已通过 xAPI 发布，根路径、登录、卡片与附件真实回归通过；平台整体性能、原生规则和完整计费验收尚未收尾。**

验收标准是本项目使用 Cloudflare 官方部署方式能达到的行为。xAPI 负责代管账户、资源身份、权限和计费；不应要求应用逐文件改写构建结果、硬编码平台路径，或新增专用 HTTP 接口来代替数据库迁移。普通 Workers 与 Workers for Platforms（WfP）的原生差异要单独核实，不能一概归因为 xAPI 缺陷。

## 1. 项目、资源与构建

本轮 checkout 基线为 `7deceb3`，包含此前适配改动；不能称为未经修改的上游源码。本轮仅调整构建/部署配置，没有更改应用路由或数据库逻辑。

- React 19.2.8、vinext 1.0.0-beta.9、Vite 8.2.2、Wrangler 4.131.0。
- 这是有服务端渲染、RSC、API 和 GitHub OAuth 的应用，不是仅靠 SPA fallback 就能部署的纯静态页面。
- Worker 服务端产物：`dist/server/`；原生 Static Assets：`dist/client/`。
- `DB` 是 D1 数据库；`ATTACHMENTS` 是 R2 桶。应用仍通过原生 bindings 使用它们。
- GitHub OAuth 用于登录；GitHub App 用于读取用户授权的仓库。这两项不要求用户加入 xAPI 的 GitHub 组织。

使用 Node.js >= 22.13，按锁文件安装：

```sh
npm ci
npm run build
```

普通 Workers 的原生发布入口为：

```sh
npx wrangler deploy --config dist/server/wrangler.json
```

WfP 的原生代码发布入口为：

```sh
npx wrangler deploy --config dist/server/wrangler.json \
  --dispatch-namespace <namespace>
```

原生 WfP 仍需要平台提供 Dispatcher 并决定访问入口；namespace 中的每个 User Worker 不等于一个自动获得普通 `workers.dev` 入口的 Worker。当前 Wrangler 的 WfP 分支会在代码发布后返回，跳过普通 Workers 的 `triggersDeploy`。因此不能拿普通 Worker 的域名/Cron 发布行为直接推断 WfP。

## 2. 将同一份产物交给 xAPI

当前配置使用 Wrangler 官方 multipart 输出，替代此前的 `tools/package-xapi-worker.mjs` 自定义重新打包流程：

```sh
npm run build:xapi-workers
```

展开后是：

```sh
NEXT_PUBLIC_BASE_PATH= npm run build
npx wrangler deploy --dry-run --config dist/server/wrangler.json \
  --outfile dist/kanby.worker.bundle
```

`xapi.worker.json` 中的关键项：

```json
{
  "build": {
    "command": "npm run build:xapi-workers",
    "output": "dist/kanby.worker.bundle"
  },
  "assets": { "directory": "dist/client" }
}
```

Wrangler 的 multipart 代码包与 Static Assets 目录分别由 CLI 自动读取。用户不需要逐个选择文件或重命名 chunk；平台内部仍需遵循 CF 的 Assets manifest → upload session → 上传缺失内容 → 发布 Worker 协议。不是把所有资源硬塞成一个 JavaScript 文件。

原生 resource ID 由 xAPI 根据资源所有权替换成托管 ID，binding 名称保持 `DB` / `ATTACHMENTS`。兼容日期和 `nodejs_compat` 从 `wrangler.xapi.jsonc` 映射。不能把本地构建用的占位 ID 当成已创建的云资源。

本轮使用已经合并到 CLI `dev` 的构建，**未发布 npm 新版本**。执行机从对应 checkout 构建 CLI 后，设置路径：

```sh
export XAPI_CLI="<xapi-cli checkout>/dist/index.js"
export XAPI_API_HOST=api.test.xapi.to
node "$XAPI_CLI" workers plan --env preview --config ./xapi.worker.json --format json
```

密钥使用已有 CLI 配置或 `XAPI_KEY`，不写入项目、构建产物或文档。

## 3. 资源与外部授权配置

本轮复用测试环境现有 Worker `702a5b16-47a3-4bfe-a984-49e725409cc5` 的 preview：

| Binding | xAPI 资源 ID | 用途 |
|---|---|---|
| DB | 77d80248-4982-4b98-a81c-947ba13054d6 | 看板、卡片、成员与附件元数据 |
| ATTACHMENTS | cc787e86-eccd-42af-b5fc-7a3246d33f34 | 附件文件 |

首次新项目应由 xAPI 的资源创建流程开通资源并返回托管身份；本轮没有重建、清空或删除以上资源。

通过 `workers secrets set <worker-id> <NAME> --env preview --from-env <VARIABLE>` 配置运行参数。所需名称列在 `xapi.worker.json`，包括 GitHub 登录凭据、Session secret、应用 origin、GitHub App 私钥与 webhook secret。查看名称和状态用 `workers secrets list`，不要打印值。

GitHub OAuth callback 是最终应用地址的 `/api/auth/github/callback`；GitHub App setup/webhook 分别为 `/api/github/setup` 和 `/api/github/webhook`。必须在最终入口确定后更新，不能把当前共享路径的 callback 直接视为根路径 callback。

用户本轮不使用自定义域名。当前入口：

https://kanby-702a5b1647a3-preview.xapi-65a.workers.dev/

该入口是平台 Dispatcher，仍经过 enforce 计费后分发到 namespace 中的 User Worker；不是直接暴露用户脚本绕过计费。此入口由平台运维通过 CF API 创建，自动创建和控制台 URL 回写尚未接入 xAPI 公共流程，不能把这一步宣称为用户一键部署已完成。

`PUBLIC_APP_ORIGIN` 已通过 xAPI Secrets 更新为上述 origin，`PUBLIC_APP_BASE_PATH` 已删除以使用根路径。个人 GitHub OAuth App 的 homepage/callback 已同步，并真实登录成功。GitHub App setup/webhook 及仓库同步仍待验收。

原生 D1 迁移方式是：

```sh
npx wrangler d1 migrations apply DB --remote --config dist/server/wrangler.json
```

目前 xAPI Workers 的公共接口尚未提供对应的托管 D1 迁移流程。因此这里是待补齐项，不能填写不存在的 `xapi workers migrations` 命令，也不能要求用户提供平台 CF token 绕过 xAPI。已有数据库可用不代表“新项目从零创建并迁移”通过。

## 4. 本轮实际执行结果

| 检查 | 结果与范围 |
|---|---|
| 原生构建 | 通过；104 个模块、40 个静态文件 |
| 普通 / WfP dry-run 对照 | 两次官方 Wrangler 输出的 metadata、模块名、MIME、字节哈希全部相同；未通过此步骤发布 CF |
| CLI 读取原生包 | 通过；保留模块与 Assets 字节；没有逐文件修补代码 |
| 测试 API 上传 | 通过；不可变产物 `feee85a0-83b6-49ed-a9af-40e9eb83a1d0`，5,213,806 bytes |
| 服务端哈希核对 | `9b1527eb1b62e9bba5dcaf99b356089ec995c46fb44f7c56ff89955e0025d2f4`，与 CLI 一致 |
| 同键重传 | 通过；两次真实上传返回同一 artifact ID；不代表并发压力或中断恢复测试 |
| Dispatcher 更新 | 已在测试 CF 发布并回读代码哈希，保留 bindings、Tail、enforce 计费配置；旧看板三次请求均 200 |
| 新产物激活 | 已通过 xAPI `workers deploy --artifact` 执行，deployment `0c98297f-ba52-4ce7-911d-09a8d7bca352`；CF 已有 modules/assets，原资源保留 |

上传采用 CLI 相同的 `loadWorkerArtifactInput` + `uploadWorkerArtifact` 客户端，带齐 Static Assets；上传后又执行了下面的实际发布命令。`workers upload --file` 当前没有单独的 Assets 参数；用户完整项目流程应走 `workers push`，不能用只上传代码包的命令替代完整项目发布。

## 5. 实际发布与真实回归

2026-09-15 05:51:49 UTC，实际执行：

```sh
XAPI_API_HOST=api.test.xapi.to node "$XAPI_CLI" workers deploy \
  702a5b16-47a3-4bfe-a984-49e725409cc5 \
  --artifact feee85a0-83b6-49ed-a9af-40e9eb83a1d0 \
  --env preview --compatibility-date 2026-09-10 \
  --compatibility-flags nodejs_compat \
  --idempotency-key native-root-kanby-20260915-v1 --format json
```

CF User Worker：`xapi-702a5b1647a3-preview`，namespace `xapi-workers-test`。
应用代码由 xAPI 完整产物发布，没有逐文件修补或通过 CF API 绕过 xAPI 发布应用。

真实浏览器新项目：
[Kanby Native Acceptance 0915](https://kanby-702a5b1647a3-preview.xapi-65a.workers.dev/kanby-native-acceptance-0915/board)。
个人账号 `dxiongya` 登录后创建项目、创建卡片、上传 627190 bytes 的 `og.png`，页面显示上传中状态，刷新后数据与 1200px 图片仍可读取。图片使用 `/api/attachments?id=...` 根路径；同一附件未登录访问返回 401。旧项目和数据保留。

另发现中文 slug 首次加载失败；相同产物在官方 Wrangler 上也传入 URL 编码后的 slug，而应用按未编码字符串匹配。此项是应用/框架适配问题，不能通过 xAPI 全局 URL 解码规避。

### 本轮 503 与速度结论

24 并发首次复现 24 个资源中 11 个 503，错误 `worker_lifecycle_data_incomplete`。内部授权真实返回 409 `wallet_transfer_in_progress`，是钱包 fence 锁冲突，并非 R2 文件丢失。PR126 已合入 dev。Dispatcher 仅针对明确的该 409 使用同请求 ID、同正文、同 5 秒 deadline 有界重试；不重试余额拒绝/未知异常，不放宽计费。86 项测试通过。

已发布到根路径测试入口（06:16:12 UTC）及共享测试 Dispatcher（06:29:49 UTC），回读 SHA256：`4d83e3d1c1ce902d5730c7b631f8d61eb185a7c87147ee43cd3764b5bdf6ec12`。共享入口通过 content-only API 更新，bindings、Tail、计费配置等逐项一致；生产未改。

两轮 24 并发、每轮 34 个静态资源，均 34/34 返回 200。第二轮单资源总耗时约 0.62–3.61 秒，**可用性修复不等于性能完成**。

签名诊断请求从测试 API 容器发出：4 个串行请求授权 99–180ms；12 并发授权 109–1007ms。静态 manifest 的分发耗时仅 3–20ms。此观测分离了平台准入和 User Worker 分发，但不是用户电脑到 CF 的网络耗时。

原生缓存规则另有缺口：构建 `_headers` 设置一年 immutable，官方 Wrangler 返回正确值，线上却是 `max-age=0, must-revalidate`。原因是 provider 没把根规则文件传入 `assets.config._headers/_redirects`。修复已提交 PR127（commit `11246f94`），通过 50 项 provider 测试/API 构建，须经 dev 部署和真实响应头回归后才算上线。

### 后续标准流程与尚未通过项

入口与配置差异补齐后，正常项目发布应使用：

```sh
node "$XAPI_CLI" workers plan --env preview --config ./xapi.worker.json
node "$XAPI_CLI" workers push --env preview --config ./xapi.worker.json
```

本轮已完成产物发布，但 `plan.canApply=true` 只表示现有计划规则允许执行，不证明原生 Web 入口、D1 迁移或 Cron 就绪。上面的 `push` 是后续正式流程，**本轮尚未执行**。

已核对 CF 回执、实际 bindings、产物、登录、深链接刷新和附件。GitHub 项目授权、代码更新/回滚的数据保留，以及空库迁移尚未完成，不能用当前成功项替代。

原生配置含每 10 分钟的 Cron。需要核实 WfP 对该触发方式的支持及通用适配方案；现有 xAPI HTTP 定时请求不能直接冒充 `scheduled()` 的等价实现。

性能与计费继续真实回归：缓存/预授权原型未接入生产计费协议，不能据此声称性能改造完成。费用以实际调用、账本、钱包、CF 计量逐项核对，API 上传成功不代表这部分通过。

当前 xAPI JSON 通道仍有 200 模块、模块总量 10 MiB、模块与 Assets 解码合计 12 MiB、输入 multipart 18 MiB 的限制。这是平台当前容量边界，不能称为 CF 原生完整上限。本项目通过不代表所有应用都已兼容。

## 参考与证据

- [CF WfP Static Assets 发布协议](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/static-assets/)
- [CF WfP 工作方式](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/)
- [CF workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- 本地锁定 Wrangler 4.131.0：`node_modules/wrangler/wrangler-dist/cli.js` 中 WfP 发布分支在 `deployWfpUserWorker` 后返回，普通分支随后才调用 `triggersDeploy`。
- 工作区 `reports/kanby-native-deployment-20260915/`：原生产物完整性、WfP 对照、真实上传、幂等和路由状态证据。


本轮费用快照：05:50:29 UTC xAPI 日账本净额 $0.00032913，06:09:39 UTC 为 $0.00036235（差额 $0.00003322，仅覆盖该窗口）。数据质量仍为 INDETERMINATE，保留金额/风险敞口等为 null，不能解释为 0，也不能称为完整账单验收或 CF 最终发票。

06:35:33 UTC 最新 xAPI 日账本净额为 $0.00108689，其中运行 $0.00063066、D1 $0.00009030、R2 $0.00036593；包含本轮操作、页面轮询及同时发生的访问，并非独立压测成本。数据质量仍为 INDETERMINATE。新卡片整卡拖拽至进行中，刷新后状态与附件均保留。
