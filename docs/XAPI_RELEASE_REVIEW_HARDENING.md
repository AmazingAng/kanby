# 发布清单：评审修复第二部分（加固，迁移 0022，CLI 0.8.0）

这是待执行的清单，不是已完成的记录。本 PR 叠在
[XAPI_RELEASE_REVIEW_FIXES.md](XAPI_RELEASE_REVIEW_FIXES.md)（迁移 0021）之上，
必须先完成 0021。数据库变更同样只能走
[XAPI_DEPLOY.md「Database migration」](XAPI_DEPLOY.md#database-migration)
的维护制品和 `/__kanby_migration`，不要用 `wrangler d1 migrations apply --remote`。
先预览，后生产；先迁移，后 promote（新代码读取新列/新表，未迁移时登录态校验会失败
并按设计拒绝所有 Cookie，即全员被登出）。

## 本次变更需要的部署动作

- `drizzle/0022_review_hardening.sql`：5 条语句。
  - 新表 `session_revocations` 及索引：登出的会话 ID，保留到 Cookie 过期。
  - `users.sessions_revoked_at`：移除成员时写入，早于该时间签发的 Cookie 全部失效。
  - `projects.last_task_number`（`NOT NULL DEFAULT 0`）+ 一条回填
    `UPDATE`：按当前最大任务编号初始化，编号以后只增不减。
- 不新增 secret。Feishu/企业微信机器人 webhook 和签名密钥改为用**已有的**
  `WEIXIN_CREDENTIAL_KEY` 加密（预览、生产都已声明）。注意：此后轮换该 key 会同时
  让已绑定的微信通知和所有机器人通知失效（无法解密的渠道会被跳过，不会发送），
  需要成员重新添加机器人。
- 已有的明文机器人记录在第一次被读取（打开设置页或发送通知）时自动重新加密，
  无需维护 SQL。上线一段时间后可用只读查询确认：
  `SELECT COUNT(*) AS plaintext FROM notification_channels WHERE webhook_url LIKE 'https://%'`
  （期望逐渐降为 0；不常用的项目可能要等到有人打开设置页）。
- 登录态：上线前签发的 Cookie 没有会话 ID，仍然有效；用这类 Cookie 登出时会使该用户
  所有更早的会话失效（其他设备需要重新登录），属预期行为。
- 移除成员会立即撤销其在该项目的 Agent Token、释放其认领，并让其所有浏览器会话失效
  （其他项目的成员身份不受影响，重新登录即可）。
- 不新增定时任务。

## 批次

按 `--> statement-breakpoint` 拆分（不要按分号拆），追加 `d1_migrations` 记录：

```sh
node -e '
const fs = require("fs");
const name = "0022_review_hardening";
const statements = fs.readFileSync(`drizzle/${name}.sql`, "utf8")
  .split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
statements.push(
  `INSERT INTO d1_migrations (name, applied_at) VALUES (\x27${name}.sql\x27, CURRENT_TIMESTAMP)`,
);
fs.writeFileSync(
  `outputs/xapi-release-review-hardening/private/${name}.json`,
  JSON.stringify({ id: `release-review-hardening:${name}`, statements }),
);'
```

共 6 条语句，在每批 40 条、1 MiB 的限制内。

## 预览

- [ ] `d1_migrations` 最后一条是 `0021_review_integrity.sql`。
- [ ] 维护制品 + 临时迁移 secrets，POST `0022_review_hardening.json`，期望 `{ok: true}`，
      重发期望 `replay: true`。
- [ ] 验证：`SELECT COUNT(*) AS n FROM projects WHERE last_task_number < COALESCE((SELECT MAX(task_number) FROM tasks WHERE tasks.project_id = projects.id), 0)`
      期望 0；`SELECT name FROM sqlite_master WHERE name = 'session_revocations'`。
- [ ] 推送正常制品，删除迁移 secrets，`/__kanby_migration` 返回 404，预览恢复
      schedule 保持暂停。
- [ ] 预览验收：
  - [ ] 登出后，用登出前复制的 Cookie 请求 `/api/auth/session` 得到未登录。
  - [ ] 移除测试成员后，其浏览器立即失去登录，其 Agent Token 返回 401；重新邀请后旧
        Token 仍然 401。
  - [ ] 删除编号最大的已归档任务后新建任务，编号不复用。
  - [ ] GitHub 以“not planned”关闭关联 Issue，卡片不移动。
  - [ ] 新加一个机器人：`SELECT webhook_url FROM notification_channels` 显示 `v1.` 开头；
        交出卡片后机器人收到消息。
  - [ ] 任务详情：Esc 关闭（有冲突或保存失败时不关闭）、Tab 不跑出对话框、关闭后焦点
        回到卡片。
  - [ ] CLI 0.8.0（仓库内 `node packages/cli/bin/kanby.js`）：`kanby auth login --url <预览>`
        在提示符输入 Token 成功；`KANBY_URL` 换成别的地址时不发送保存的 Token。

## 生产

- [ ] 暂停生产恢复 schedule，完整备份。
- [ ] 维护制品应用 0022；比对：业务表一致，预期差异只有新列（`projects.last_task_number`
      为回填值、`users.sessions_revoked_at` 为 NULL）和新空表 `session_revocations`。
- [ ] promote 预览验收过的同一制品，删除迁移 secrets，确认 404。
- [ ] 恢复生产 schedule，立即运行一次并确认成功。
- [ ] 冒烟：登录、登出、看板、`/api/v1/next`。

## CLI 与技能

- [ ] `npm run cli:pack:check`，然后 `npm publish --workspace @kanby/cli` 发布 0.8.0
      （npm 上目前没有任何已发布版本；0.7.0 从未发布）。
- [ ] 通知团队：升级 CLI，重新安装 `skills/kanby`；旧配置会按原 URL 继续使用，
      不再推荐 `--token`。

## 回滚

迁移追加式。回滚 promote 上一个生产制品即可，旧代码忽略新表/新列；但旧代码不认识
已加密的机器人 webhook（`v1.` 开头），回滚后这些机器人无法发送，需要成员重新添加，
或在回滚前不要让新代码运行太久。旧代码签发/校验的 Cookie 与新代码兼容。
