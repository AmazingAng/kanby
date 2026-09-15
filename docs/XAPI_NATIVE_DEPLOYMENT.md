# Kanby 经 xAPI 部署：原生基线与执行记录

更新：2026-09-15。**状态：构建与真实产物上传已验证，完整应用发布验收尚未完成。**

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

用户本轮不使用自定义域名。平台尚未提供这个项目可用的根路径默认入口；不能把“要求用户购买域名”作为本轮收尾方式。

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
| 新产物激活 | **未执行**；当前入口仍为 PATH_FALLBACK / webAppReady=false，不能把根路径构建覆盖上去后宣称成功 |

上传采用 CLI 相同的 `loadWorkerArtifactInput` + `uploadWorkerArtifact` 客户端，带齐 Static Assets，仅验证不可变产物上传，未调用发布。`workers upload --file` 当前没有单独的 Assets 参数；用户完整项目流程应走 `workers push`，不能用只上传代码包的命令替代完整项目发布。

## 5. 发布与完整验收仍待执行

入口与配置差异补齐后，正常项目发布应使用：

```sh
node "$XAPI_CLI" workers plan --env preview --config ./xapi.worker.json
node "$XAPI_CLI" workers push --env preview --config ./xapi.worker.json
```

目前 `plan.canApply=true` 只表示现有计划规则允许执行，不证明原生 Web 入口、D1 迁移或 Cron 就绪。上面的 `push` 是后续正式流程，**本轮尚未执行**。

发布后必须核对 CF 回执/实际 bindings/产物，再测 `/`、`/demo`、登录 callback、看板深链接刷新、附件上传与读取、卡片修改、GitHub 项目授权、代码更新与回滚后数据保留。

原生配置含每 10 分钟的 Cron。需要核实 WfP 对该触发方式的支持及通用适配方案；现有 xAPI HTTP 定时请求不能直接冒充 `scheduled()` 的等价实现。

性能与计费另行真实回归：当前三次旧看板烟测仍观测到 173–318ms 的平台准入耗时；缓存/预授权原型未接入生产计费协议，不能据此声称性能改造完成。费用以实际调用、账本、钱包、CF 计量逐项核对，API 上传成功不代表这部分通过。

当前 xAPI JSON 通道仍有 200 模块、模块总量 10 MiB、模块与 Assets 解码合计 12 MiB、输入 multipart 18 MiB 的限制。这是平台当前容量边界，不能称为 CF 原生完整上限。本项目通过不代表所有应用都已兼容。

## 参考与证据

- [CF WfP Static Assets 发布协议](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/static-assets/)
- [CF WfP 工作方式](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/)
- [CF workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- 本地锁定 Wrangler 4.131.0：`node_modules/wrangler/wrangler-dist/cli.js` 中 WfP 发布分支在 `deployWfpUserWorker` 后返回，普通分支随后才调用 `triggersDeploy`。
- 工作区 `reports/kanby-native-deployment-20260915/`：原生产物完整性、WfP 对照、真实上传、幂等和路由状态证据。
