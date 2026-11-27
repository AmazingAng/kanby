# 发布清单：轮次协作 + 微信通知（迁移 0017–0019，CLI 0.7.0）

这是待执行的清单，不是已完成的记录。完成后按
[XAPI_RELEASE_20261001.md](XAPI_RELEASE_20261001.md) 的格式补一份证据文档
（部署 ID、制品 ID 与 SHA-256、备份与比对结果）。

背景：kanby.dev 跑在 xAPI Workers 上，D1 在 xAPI 账号下，
`wrangler d1 migrations apply --remote` 连不到它。数据库变更只能走
[XAPI_DEPLOY.md「Database migration」](XAPI_DEPLOY.md#database-migration)
的临时维护制品和受保护的 `/__kanby_migration` 接口。先预览，后生产。
通用的构建、plan/push/promote 和定时任务命令以 XAPI_DEPLOY.md 为准，这里不重复。

本次发布的变更：设计见
[design/turn-based-collaboration.md](design/turn-based-collaboration.md)。

- `drizzle/0017_turn_collaboration.sql`：16 条语句，约 3 KB。tasks 增加
  `turn_*` 列（全部可空），新建 `task_mentions`、`task_read_cursors`、
  `notification_channels`、`notification_deliveries`，并回填 building 卡的轮次。
- `drizzle/0019_read_cursor_event.sql`：1 条语句。`task_read_cursors` 增加
  `read_event_id`，让读游标成为稳定的 `(created_at, id)` 位置。
- `drizzle/0018_weixin_accounts.sql`：3 条语句。新建 `weixin_accounts`、
  `weixin_logins`。
- 新 Worker secret：`WEIXIN_CREDENTIAL_KEY`（已在 `xapi.worker.json` 的
  preview 和 production secrets 中声明）。
- 不新增定时任务；现有 `*/10 * * * *` 恢复任务不变。

## 维护接口能否直接应用 0017–0019

可以，`tools/xapi-migration.mjs` 不需要改动。它不读取迁移文件，而是执行请求里
给出的 SQL 批次：每批最多 40 条单独的 SQL、1 MiB，加上摘要标记一起原子提交，
同 ID 同内容可安全重放。0017 拆成 16 条，加上 `d1_migrations` 记录共 17 条；
0018 为 4 条，0019 为 2 条，都在限制内。按 `--> statement-breakpoint` 拆分（与
`tests/support/d1.ts` 相同），不要按分号拆。

0017 在同一批里先 `ALTER TABLE` 再 `UPDATE` 新列；0016 也是在同一批里先建表
再插入，且已成功。预览环境先跑一遍即可确认；若预览失败（整批会回滚），把最后
一条回填 `UPDATE` 单独作为第二批（新的批次 ID），`d1_migrations` 记录放在第二批。

## 0. 准备

- [ ] 发布提交：记录 `main` 的提交 SHA，并确认它的 CI 通过。之后两个环境都用
      这个提交的干净导出构建（不要带本地 `.env*`）。
- [ ] 生成密钥：`openssl rand -base64 32`，分别为预览和生产生成**不同**的值。
      不要打印到共享日志、不要写进命令行参数或仓库。
- [ ] 在 kanby Worker（`3ef2459b-f47d-4a59-a46f-8dc132346df4`）的**预览**和
      **生产** xAPI Secrets 中设置 `WEIXIN_CREDENTIAL_KEY`。必须在部署任何制品
      （包括维护制品）之前设置，因为清单已声明该 secret。
- [ ] 准备只用于本次的私有目录（如 `outputs/xapi-release-turn-weixin/private/`，
      已被忽略），存放备份、批次 JSON 和验证结果。

生成两个批次文件（只在本地执行，不访问任何环境）：

```sh
node -e '
const fs = require("fs");
for (const name of ["0017_turn_collaboration", "0018_weixin_accounts", "0019_read_cursor_event"]) {
  const statements = fs.readFileSync(`drizzle/${name}.sql`, "utf8")
    .split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  statements.push(
    `INSERT INTO d1_migrations (name, applied_at) VALUES (\x27${name}.sql\x27, CURRENT_TIMESTAMP)`,
  );
  fs.writeFileSync(
    `outputs/xapi-release-turn-weixin/private/${name}.json`,
    JSON.stringify({ id: `release-turn-weixin:${name}`, statements }),
  );
}'
```

## 1. 预览环境

- [ ] 用 `{query: "SELECT name FROM d1_migrations ORDER BY id"}` 确认最后一条是
      `0016_interaction_sessions.sql`，且没有 0017–0019。
- [ ] 按 XAPI_DEPLOY.md 构建并推送维护制品到预览：`KANBY_XAPI=1 KANBY_MIGRATION=1`。
- [ ] 设置预览临时 secrets：`KANBY_MIGRATION_TOKEN`（随机，至少 64 字符）和
      `KANBY_MIGRATION_EXPIRES`（短期的未来毫秒时间戳）。
- [ ] 确认维护制品 `/demo` 正常，普通页面返回 503。
- [ ] 依次 POST `0017_turn_collaboration.json`、`0018_weixin_accounts.json`、
      `0019_read_cursor_event.json` 到预览
      主机的 `/__kanby_migration`（`Authorization: Bearer <token>`，只发给预览的
      HTTPS 主机）。每批都应返回 `{ok: true}`；同批重发应返回 `replay: true`。
- [ ] 验证（接口只允许单条 SELECT）：`d1_migrations` 末尾依次是 0017、0018、0019；再查，例如
      `SELECT COUNT(*) AS n FROM tasks WHERE turn_kind IS NOT NULL`、
      `SELECT name FROM sqlite_master WHERE name IN ('task_mentions','task_read_cursors','notification_channels','notification_deliveries','weixin_accounts','weixin_logins')`。
- [ ] 构建正常制品（`KANBY_XAPI=1 KANBY_PUBLIC_ORIGIN=https://kanby.dev npm run build`，
      **不设** `KANBY_MIGRATION`），`plan` 后推送到预览，记录制品 ID 和 SHA-256。
- [ ] 删除预览的 `KANBY_MIGRATION_TOKEN`、`KANBY_MIGRATION_EXPIRES`；确认 GET 和 POST
      `/__kanby_migration` 返回 404。
- [ ] 检查定时任务：`push` 可能重新启用预览的恢复任务，确认预览恢复任务仍为暂停。
- [ ] 预览验收（用测试项目和测试 Agent Token，不复制生产数据）：
  - [ ] 网页「轮到我 / 看板」切换、卡片轮次标签、任务详情「交出」、评论 @。
  - [ ] CLI 0.7.0（仓库内 `node packages/cli/bin/kanby.js`，`KANBY_URL` 指向预览）：
        `next`、`task get`（含 unread）、`task comment` 带 @、`task handoff`。
  - [ ] 设置页「机器人通知」添加一个测试企业微信或飞书机器人，交出卡片后收到消息。
  - [ ] 设置页「微信通知」扫码绑定、发一句话、点「我已发送」变为已连接，
        「发送测试消息」收到。

## 2. 生产环境

- [ ] 暂停生产恢复定时任务（`29c4626a-1f34-8eb3-a6c2-231c81936ce0`）。
- [ ] 完整备份生产数据库（所有表、行数和规范化行内容），存入私有目录。
- [ ] 部署维护制品到生产，设置生产临时 `KANBY_MIGRATION_TOKEN` 与
      `KANBY_MIGRATION_EXPIRES`。维护期间普通访问返回 503。
- [ ] 确认 `d1_migrations` 最后是 0016，然后依次应用 0017、0018、0019（同上，主机换成
      生产）。
- [ ] 比对：所有已有业务表与备份逐表比对行数和完整规范化行内容。预期差异只有：
      `tasks` 多出 `turn_*` 列，以及回填改动的 building 卡（记录回填条数）；
      `d1_migrations`、`__kanby_imports` 和 SQLite 序列元数据不参与比对。
- [ ] 把**预览验收过的同一个正常制品** promote 到生产（不要重新构建）。
- [ ] 删除生产迁移 secrets，确认 GET 和 POST `/__kanby_migration` 返回 404。
- [ ] 重新启用生产恢复定时任务，执行一次立即运行并确认成功；确认只有一个生产恢复任务启用。
- [ ] 生产冒烟：公开页面、OAuth 回调跳转、带登录的任务列表/活动/指标、
      `GET /api/turns`、`GET /api/v1/next`（Agent Token）、未登录访问被拒。

### 可选：不保留回填的轮次

迁移会把未归档 building 卡交给第一负责人（最新进度含「待验收」类字样的为待验收）。
如果团队不希望上线当天出现这批积压，在维护制品仍在、迁移 secrets 未删除时，用单独的
批次（如 `release-turn-weixin:clear-backfill`）执行：

```sql
UPDATE tasks SET turn_kind = NULL, turn_user_id = NULL, turn_token_id = NULL, turn_reason = NULL, turn_note = NULL, turn_since = NULL
```

## 3. CLI 与技能

- [ ] 发布 `@kanby/cli` 0.7.0：`npm publish --workspace @kanby/cli`（发布前
      `npm run cli:pack:check`）。
- [ ] 通知团队：升级 CLI 到 0.7.0，重新安装 `skills/kanby`，每人用自己的 Agent Token。

## 4. 微信通知实测（部署后）

记录每次结果（成功/失败与错误信息，设置页会显示最近错误）：

- [ ] 刚激活后立即「发送测试消息」。
- [ ] 激活后几小时（期间不给机器人发消息）再发一次。
- [ ] 第二天再发一次。
- [ ] 期间交出一张卡给自己，确认微信收到；若微信失败，确认改由个人飞书/企业微信机器人送达，
      且设置页显示「已失效」。

结论决定下一增量：若不先发消息也能长期推送，只需加回复写回卡片；若对话凭证会过期，
需要定时拉取微信消息续期，并在失效时提醒本人回一句。

## 回滚

迁移是追加式的，代码回滚不会撤销表和列，旧代码会忽略它们。需要回滚时 promote 上一个
生产制品即可；不要删除新表。确需撤销回填，用上面的清空语句。
