# 「轮到谁」协作模型（Turn-based collaboration）设计

状态：阶段 1 实施中 · 基线 `main a17a666` · 输入：`kanby-refactor-proposal.md`、`kanby-collab-review.md`

## 0. 一句话

把卡片的中心从「在哪一列」换成「现在轮到谁、为什么」。列继续存在，但每张进行中的卡都明确挂在某个成员或某个成员的 agent 名下，并带原因和起始时间；人和 agent 都从「轮到我」队列开工，交接、@、打回会推送到飞书或企业微信。

## 1. 现状（与提案相关的代码事实）

| 事实                                                                                                                   | 位置                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 状态只有 `tasks.status ∈ ideas/building/shipped`，团队指标（`task_metric_state` 视图、触发器）和 GitHub 自动化都基于它 | `db/schema.ts`、`drizzle/0015_team_metrics.sql`、`lib/github-automation.ts` |
| 负责人：`task_assignees`（最多 3 人），`tasks.owner_*` 是兼容字段                                                      | `lib/db.ts updateTask`                                                      |
| 统一流水：`task_events`（source=user/agent/github/system，`kind` 字符串，`body`≤2000）                                 | `lib/task-activity.ts`                                                      |
| Agent 写入先进 `task_agent_updates`，再镜像为 `task_events` 的 `agent.*`                                               | `lib/agent.ts recordAgentUpdate`                                            |
| 评论只有网页能写（`comment.created`）；agent 读任务只拿自己最近 20 条 `task_agent_updates`                             | `app/api/task-events/route.ts`、`app/api/v1/tasks/route.ts detailedTask`    |
| 租约：`progress`、附件上传在别人持有租约时 409                                                                         | `recordAgentUpdate(requireClaimAccess)`、`app/api/v1/attachments/route.ts`  |
| Agent Token 归属成员（`agent_tokens.user_id`），名字只是 token 名（如 `codex`）                                        | `lib/agent.ts`、`lib/agent-token-policy.ts`                                 |
| 会话 wait/reply 只做计时遥测，网页没有入口                                                                             | `lib/interaction-sessions*.ts`                                              |
| 无通知、无 @、无「轮到我」                                                                                             | —                                                                           |

## 2. 与提案冲突处及处理

1. **「列由轮次推导，不再是主视图」**：`status` 是指标、GitHub 自动化、拖拽排序的真相源，直接废弃会破坏团队报表的口径。→ 阶段 1 **轮次与列正交**：`status` 仍是存储字段，轮次是新增字段；`shipped`/归档的卡不进入任何队列（查询时过滤，不清字段）。「轮到我」成为显眼的默认视图（有待办时默认打开），看板保留。阶段 2 再评估由轮次自动推进列（如 `developing` 自动把 ideas 推到 building）。
2. **「@ 等于轮到对方」**：如果 @ 直接改写轮次，会把正在开发的人的轮次抢走，多人 @ 也无法表达。→ @ 产生一条独立的**待回应提及**（`task_mentions`），同样进入被 @ 人的「轮到我」队列和通知；被 @ 人（或其 agent）在卡上评论或交接后自动关闭。真正改轮次只能用「交出」（handoff）。
3. **「会话并入轮次」**：会话代码有 100% 覆盖率和变异测试门槛，阶段 1 改它收益小、风险大。→ 阶段 1 技能不再让 agent 用 `session wait` 提问，改用 `handoff --reason awaiting_decision`（这本身就是「轮到某人决策」）；会话 API 保持不变、继续做遥测。阶段 2 再让带 `taskId` 的 `wait/reply` 自动写轮次。
4. **「讨论串分两个可见级别」**：阶段 1 不加列，由 `kind` 推导 `visibility`（见 §3.3），先用于 agent 的「新内容」过滤；网页按级别折叠是阶段 2。
5. **「验收被打回」**：系统里没有「打回」动作。→ 定义为：卡当前原因是 `awaiting_acceptance`，被交给别人且新原因是 `developing`/`blocked`，记为 `turn.rejected` 并按「打回」通知。
6. **「工作空间」**：Kanby 的协作边界是 project，通知配置挂在 project（群机器人）和 project 成员（个人机器人）两级。

## 3. 数据模型（迁移 `drizzle/0017_turn_collaboration.sql`，只追加）

### 3.1 `tasks` 新增列

| 列              | 说明                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `turn_kind`     | `member` / `agent` / NULL（无人轮到，如 ideas 积压）                                                                          |
| `turn_user_id`  | 轮到的成员；`agent` 时为该 agent 的主人                                                                                       |
| `turn_token_id` | 指定某个 agent token；NULL 表示「该成员的任一 agent」                                                                         |
| `turn_reason`   | `developing` 开发中 · `awaiting_acceptance` 待验收 · `awaiting_decision` 待决策 · `blocked` 被阻塞 · `awaiting_review` 待复核 |
| `turn_note`     | 交接说明（≤500 字，例如「看这三点」）                                                                                         |
| `turn_since`    | 本轮开始时间（毫秒），队列按它升序＝等待最久的在前                                                                            |

索引 `idx_tasks_project_turn(project_id, turn_user_id, turn_since)`。轮次变化**不改 `updated_at`**，因此不会和正在编辑卡片的人产生修订冲突，也不触发指标快照。

### 3.2 新表

- `task_mentions(id, project_id, task_id, event_id, target_user_id, target_token_id, target_kind, created_by, created_at, resolved_at)`：待回应提及。
- `task_read_cursors(task_id, reader_id, project_id, read_at, read_event_id)`，主键 `(task_id, reader_id)`：agent 读卡游标（`reader_id`=token id）。游标是 `(read_at, read_event_id)` 稳定位置（`read_event_id` 由迁移 0019 加入），只推进到实际返回的最新一条未读，未读和讨论串都分页返回。网页端未读标记留到阶段 2，复用同表（`reader_id`=user id）。
- `notification_channels(id, project_id, user_id, kind, webhook_url, secret, enabled, created_by, created_at, updated_at)`：`user_id` 为 NULL＝项目群机器人（仅项目 owner 可配），否则为该成员的个人机器人（仅本人可配）。`kind ∈ feishu/wecom`。
- `notification_deliveries(id, project_id, channel_id, task_id, event_kind, status, error, created_at)`：投递日志，失败只记录不重试。

### 3.3 讨论串类型与可见级别（由 `kind` 推导，不加列）

- **conversation（给人看）**：`comment.created`、`turn.changed`、`turn.rejected`、`agent.progress`、`agent.completed`、`task.created`、`acceptance.*`、`github.pull_request.*` 中的 merged/closed。
- **record（留档）**：`agent.heartbeat/claimed/released/linked/attached`、`task.updated`、`github.ci.*`、`github.push.*` 及其它。

`comment.created` 现在 source 可以是 `user` 或 `agent`；metadata 带 `mentions: [{userId, login, tokenId, kind}]`。交接写 `turn.changed`，metadata 带前后轮次。

### 3.4 Agent 显示名

所有 agent 写入的流水摘要从 `codex 汇报了进度` 改为 `Alice 的 codex 汇报了进度`（`actor_name` 仍是 token 名，`actor_login` 是主人 login，网页据此渲染「<成员> 的 <agent>」）。卡片上「Agent 正在处理」同样显示主人。

## 4. API

### 4.1 Agent v1（Bearer `kby_`）

| 接口                                                        | 行为                                                                                                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tasks`                                         | 每张卡多返回 `turn`                                                                                                                                                                    |
| `GET /api/v1/tasks?id=<ref>`                                | 新增 `turn`、`thread`（最近 30 条 conversation 事件）、`unread`（他人在本 token 上次读取之后写的 conversation 事件）、`lastReadAt`；默认推进读游标，`&markRead=0` 只看不推进           |
| `GET /api/v1/next`                                          | 「轮到我」：`turns`（轮到本 token、本成员的任一 agent、或本成员本人的卡，含 `unreadCount`），`mentions`（@ 本成员或其 agent 的未关闭提及），按等待时长排序；只读                       |
| `PATCH {action:"comment", id, body}`                        | 发评论（≤2000），解析 @，**不受租约限制**                                                                                                                                              |
| `PATCH {action:"handoff", id, to, reason, note?, release?}` | 交出轮次；`to` = `@login`（成员）/ `@login/agent`（该成员任一 agent）/ `@login/<agent名>` / `owner`（本 token 的主人）/ `self` / `none`；默认顺便释放本 token 的租约；**不受租约限制** |
| `PATCH {action:"progress"}`、`POST /api/v1/attachments`     | **去掉租约限制**（复核方也能写进度和传证据）                                                                                                                                           |

仍受租约保护（改「代码工作/卡片结构」）：`update`、`link`、`split`、`complete`、`archive`、`checklist.*`、`heartbeat`/`release`（只对持有者有意义）。

### 4.2 网页（会话 cookie，同源校验）

| 接口                                         | 行为                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/turns?projectId=`                  | 当前用户的队列：轮到我、轮到我的 agent、@ 我                                        |
| `POST /api/task-turn`                        | `{projectId, taskId, to:{kind,userId,tokenId?}                                      | null, reason, note}` 设置/交出轮次 |
| `POST /api/task-events`                      | 评论，新增 @ 解析、提及与通知                                                       |
| `GET/POST/DELETE /api/notification-channels` | 配置项目群机器人（owner）和个人机器人（本人）；返回时 webhook 只显示主机名和末 4 位 |
| `GET /api/tasks`                             | 卡片带 `turn`；网页支持 `?task=KANBY-12` 深链接（通知里的链接）                     |

## 5. CLI（`@kanby/cli` 0.6.0 → **0.7.0**，新增命令、不破坏旧命令）

```
kanby next [--json]                                   # 轮到我和我主人的卡 + 被 @ + 新回复
kanby task get <ref> [--no-mark-read]                 # 输出轮次、讨论串和「自上次以来的新内容」
kanby task comment <ref> <text>                       # 可含 @alice、@alice/agent
kanby task mention <ref> @alice [<text>]              # 等价于带 @ 的评论
kanby task handoff <ref> --to @alice --reason awaiting_acceptance --note "看这三点"
```

## 6. 技能变更（`skills/kanby/SKILL.md` + `references/cli.md`）

- 开工先 `kanby next`，对要做的卡 `task get`，逐条回应 `unread` 里的人话。
- 认领只用于改代码；评论、复核意见、附件不需要认领。
- 做完不再「写一句待验收再 release」，而是 `handoff --to @主人 --reason awaiting_acceptance --note "<要看什么>"`；需要人拍板用 `--reason awaiting_decision`；被卡住用 `blocked`。
- 不引用本机路径，证据一律 `task attach` 上传并在进度/交接说明里引用附件名。
- 会话改为可选遥测，提问不再走 `session wait`。

## 7. 通知

- 触发：轮次交给你（含交给你的 agent）、你被 @、验收被打回（`turn.rejected`）。人自己交给自己不通知；agent 交给主人要通知。
- 投递：项目群机器人收到所有事件（文本里写被通知人名字）；被通知人若配置了个人机器人，再单独推一份。
- 格式：飞书自定义机器人 `{"msg_type":"text","content":{"text":...}}`，配置了签名密钥时带 `timestamp`+`sign`（HmacSHA256，key=`timestamp\nsecret`）；企业微信群机器人 `{"msgtype":"text","text":{"content":...}}`。文本含卡号、标题、原因、交接说明、深链接。
- 安全：只允许 `https://open.feishu.cn`、`https://open.larksuite.com`、`https://qyapi.weixin.qq.com` 的 webhook（防 SSRF）；webhook 和签名密钥存 D1，只有配置者/owner 可改，API 永不回显完整值，日志不打印 URL；仓库里不放任何真实 webhook。
- 尽力而为：通过 `cloudflare:workers` 的 `waitUntil` 在响应后发送（不可用时同步发送，超时 4 秒）；失败写 `notification_deliveries` 和 `console.error`，不影响主请求。
- 不需要新环境变量；链接域名取现有 `PUBLIC_APP_ORIGIN`。

## 8. 迁移与回填

迁移内一次性回填（仅未归档卡）：

- `building` 卡：轮到第一负责人；最新一条 `agent.progress` 含「待验收/待用户验收/等待验收/待人工验收」则原因为 `awaiting_acceptance`，否则 `developing`；`turn_since` 取该进度时间，没有进度取 `updated_at`。
- `ideas`、`shipped` 卡：不设轮次。

效果是上线当天每个人的「轮到我」会出现积压的待验收卡（评估里约 19 张），这正是要清理的对象。若不希望回填，可在应用迁移后执行 `UPDATE tasks SET turn_kind=NULL, turn_user_id=NULL, turn_reason=NULL, turn_since=NULL`。

部署顺序：先应用迁移（新列都可空，旧代码不受影响），再部署正常 Worker，最后发布 CLI 0.7.0。kanby.dev 跑在 xAPI Workers 上，D1 在 xAPI 账号下，`wrangler d1 migrations apply --remote` 连不到它；生产和预览都必须走 [XAPI_DEPLOY.md「Database migration」](../XAPI_DEPLOY.md#database-migration) 的维护制品 + `/__kanby_migration` 流程，本次发布的逐步清单见 [XAPI_RELEASE_TURN_WEIXIN.md](../XAPI_RELEASE_TURN_WEIXIN.md)。`wrangler d1 migrations apply DB --local` 只用于本地开发。

## 9. 分阶段

- **阶段 1（本次）**：轮次字段与 API、「轮到我」网页视图和卡片轮次标签、agent 读写评论和 @、未读内容、去掉进度/附件的租约限制、agent 显示为「成员 的 agent」、飞书/企业微信推送、`kanby next/comment/mention/handoff`、技能更新、测试。
- **阶段 2**：任务简报（可整体改写）；讨论串按可见级别折叠/过滤、进度 Markdown 渲染；结构化进度（结论/下一步/需要谁）；网页未读标记；每日站会摘要（Cron）；会话 `wait/reply` 自动写轮次；轮次驱动列（ideas→building 自动推进）；可选邮件。
- **阶段 3**：依赖/阻塞关系与自动通知；决策记录；MCP。

## 10. 需要确认的决定

1. 轮次与列正交、`status` 继续是真相源（§2.1）。
2. @ 是「待回应提及」而不是改轮次（§2.2）。
3. 只有 `update/link/split/complete/archive/checklist` 继续受租约保护；`progress`、评论、交接、附件不受（§4.1）。
4. 迁移内回填 building 卡的轮次（§8）。
5. 通知配置存 D1、项目群机器人由 owner 配、个人机器人由本人配，不引入环境变量（§7）。

## 11. 微信通道（2026-11-28 追加，首选）

团队不用飞书，通知首选微信；飞书/企业微信机器人降为备选。Kanby 直接对接 iLink Bot 协议（腾讯官方 `@tencent-weixin/openclaw-weixin` 渠道使用的协议），不依赖 OpenClaw。

- **绑定**：设置页「微信通知」→ Kanby 调 `ilink/bot/get_bot_qrcode` 拿登录链接，服务端用 `uqr` 渲染成二维码；本人扫码确认后（`get_qrcode_status` 返回 `confirmed`）得到 `bot_token`、机器人 ID 和本人的 iLink 用户 ID，状态为 `pending`。
- **激活**：iLink 发消息必须带对方消息里的 `context_token`。本人先给机器人发一句话，再点「我已发送」，Kanby 调 `getupdates` 取到本人消息的 `context_token`，状态变为 `active`。
- **托管与加密**（迁移 `0018_weixin_accounts.sql`）：`weixin_accounts` 按成员一行；`bot_token`、iLink 用户 ID、`context_token` 用 AES-256-GCM 加密，密钥只在 Worker secret `WEIXIN_CREDENTIAL_KEY`（32 字节 base64）里，附加数据绑定「成员 ID + 字段」，密文换到别人名下无法解密。任何 API 都不返回凭证，日志不打印。只允许访问 `*.weixin.qq.com` 的 HTTPS 主机。解绑即删除。
- **投递顺序**：接收人有 `active` 微信时先发微信；微信失败（如 `-14` 会话过期，状态改为 `expired`）或未绑定时，才发该成员的个人飞书/企业微信机器人；项目群机器人照旧。每次投递写入 `notification_deliveries`（`channel_id = weixin:<userId>`）。

**待实测**：不带新的 `context_token`、隔一段时间后主动推送是否仍成功，以及 `context_token` 的有效期。若会过期，下一步在定时任务里续期或改走备选通道。

**部署**：先在 kanby Worker 的预览和生产 xAPI Secrets 里设置 `WEIXIN_CREDENTIAL_KEY`，再按 [XAPI_RELEASE_TURN_WEIXIN.md](../XAPI_RELEASE_TURN_WEIXIN.md) 通过维护制品依次应用 0017、0018、0019（不能用 `wrangler --remote`）。

**下一增量**：定时任务（挂到 `tools/add-worker-schedule.mjs`，每分钟）对每个绑定账号调 `getupdates`，持续刷新 `context_token`，并把回复写回卡片（回复「通过 / 打回 原因 / 选 B」→ `handoff` / `comment`，以本人身份）。
