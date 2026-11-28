# 发布清单：评审修复（数据一致性与安全，迁移 0021）

这是待执行的清单，不是已完成的记录。数据库变更与
[XAPI_RELEASE_TURN_WEIXIN.md](XAPI_RELEASE_TURN_WEIXIN.md) 相同，只能走
[XAPI_DEPLOY.md「Database migration」](XAPI_DEPLOY.md#database-migration)
的临时维护制品和受保护的 `/__kanby_migration` 接口，不要用
`wrangler d1 migrations apply --remote`。先预览，后生产。若 0017–0020 尚未在目标
环境应用，先按 XAPI_RELEASE_TURN_WEIXIN.md 和迁移 0020 的说明补齐，再做本清单。

## 本次变更需要的部署动作

- `drizzle/0021_review_integrity.sql`：5 条语句，全部追加式。
  - `github_redelivery_attempts.attempt_count`（`NOT NULL DEFAULT 1`）：按 GUID
    限制向 GitHub 请求重投的次数。
  - `notification_deliveries.recipient_key`、`sender_key` 及索引
    `idx_notification_deliveries_recipient`：按接收人/项目/发送人合并、限流通知。
    旧记录为 NULL，不参与限流，无需回填。
  - `project_invitations.github_user_id`：按 GitHub 用户 id 绑定的邀请。旧邀请为
    NULL，仍按「OAuth 登录时的最新登录名或已验证邮箱」接受。
  - 迁移日志里 0021 的 `when` 晚于 0020（之前生成的早于 0020，会被 drizzle 迁移器
    跳过；本流程按文件手工应用，不受影响，但已修正）。
- 不新增 Worker secret、不新增环境变量。
- 不新增定时任务；现有 `*/10 * * * *` 恢复任务保留。
- 代码必须与迁移一起上线：新代码写入 `recipient_key`、`attempt_count`，
  在未迁移的库上通知记录和 GitHub 重投会失败。顺序是先迁移、后 promote。

### 定时恢复签名（无需改 xAPI 配置）

Worker 的 `scheduled()` 现在签名 `kanby-recovery-v2:<毫秒时间戳>`，
`/api/github/recovery` 只接受 5 分钟内的签名；旧的固定签名
`kanby-recovery-v1` 不再被接受。生产 schedule
`29c4626a-1f34-8eb3-a6c2-231c81936ce0` 调用的是 `scheduled()`，签名在 Worker
内部生成，**不需要修改 schedule**。

旧的 HTTP 入口 `/__kanby_recovery` 只接受 `{timestamp, signature}`
（签名对象同上，且在 5 分钟内），固定的 schedule body 无法满足。已暂停的旧 HTTP
schedule `6976939e-5a83-482b-907d-f2151b68e22d` 和预览 schedule
`214e237a-2aa0-8b39-a2c3-6cc7658302f1` 因此即使被重新启用也无法触发恢复。
建议（可选）在确认生产 schedule 正常后删除这两个暂停的 schedule，因为它们的
body 里保存着已作废的旧签名。

## 批次

按 `--> statement-breakpoint` 拆分（不要按分号拆）：

```sh
node -e '
const fs = require("fs");
const name = "0021_review_integrity";
const statements = fs.readFileSync(`drizzle/${name}.sql`, "utf8")
  .split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
statements.push(
  `INSERT INTO d1_migrations (name, applied_at) VALUES (\x27${name}.sql\x27, CURRENT_TIMESTAMP)`,
);
fs.writeFileSync(
  `outputs/xapi-release-review-fixes/private/${name}.json`,
  JSON.stringify({ id: `release-review-fixes:${name}`, statements }),
);'
```

共 6 条语句（含 `d1_migrations` 记录），在每批 40 条、1 MiB 的限制内。

## 预览

- [ ] `SELECT name FROM d1_migrations ORDER BY id` 最后一条是
      `0020_weixin_mini.sql`，没有 0021。
- [ ] 部署维护制品（`KANBY_XAPI=1 KANBY_MIGRATION=1`），设置临时
      `KANBY_MIGRATION_TOKEN` / `KANBY_MIGRATION_EXPIRES`，POST
      `0021_review_integrity.json`，期望 `{ok: true}`；重发期望 `replay: true`。
- [ ] 验证：`SELECT name FROM pragma_table_info('notification_deliveries') WHERE name = 'recipient_key'`、
      `SELECT name FROM pragma_table_info('github_redelivery_attempts') WHERE name = 'attempt_count'`、
      `SELECT name FROM pragma_table_info('project_invitations') WHERE name = 'github_user_id'`、
      `SELECT name FROM sqlite_master WHERE name = 'idx_notification_deliveries_recipient'`。
- [ ] 构建并推送正常制品，删除迁移 secrets，确认 `/__kanby_migration` 返回 404，
      确认预览恢复 schedule 仍为暂停。
- [ ] 预览验收：
  - [ ] 两个浏览器同时打开看板：A 编辑卡片 X，B 拖动 X 旁边的卡片 Y；A 的自动保存
        不报冲突，Y 的位置在 A 处同步。B 用旧版本拖动 X 时提示冲突并恢复。
  - [ ] 编辑器冲突时出现「加载最新 / 复制我的内容 / 放弃我的修改」，放弃后能关闭。
  - [ ] 在设置页选择超过 99 个仓库后保存成功（如测试账号有这么多仓库）。
  - [ ] 邀请一个不存在的 GitHub 用户名，提示找不到用户。
  - [ ] 邀请一个尚未注册的 GitHub 用户名后，`project_invitations.github_user_id` 有值。
  - [ ] 快速连续拖动同一张卡两次，不出现冲突提示，顺序不回跳。
  - [ ] /mini：绑定前显示微信识别码；绑定后显示识别码、绑定时间、最近登录和会话
        列表，可单独退出会话；绑定后收到微信或个人机器人通知。
  - [ ] 设置页 GitHub「补同步历史」不移动任何卡片。

## 生产

- [ ] 暂停生产恢复 schedule，完整备份数据库（表、行数、规范化行内容）。
- [ ] 部署维护制品，应用 0021（同上，主机换成生产）。
- [ ] 比对：所有业务表与备份逐表一致；预期差异只有三张表多出的新列（旧行
      `recipient_key`/`sender_key`/`github_user_id` 为 NULL、`attempt_count` 为 1）。
- [ ] promote **预览验收过的同一个正常制品**，删除迁移 secrets，确认
      `/__kanby_migration` 返回 404。
- [ ] 恢复生产 schedule 并立即运行一次，确认返回成功（这同时验证了新签名）；确认
      只有一个生产恢复 schedule 启用。

## 回滚

迁移是追加式的，旧代码忽略新列。回滚时 promote 上一个生产制品即可，不要删除列。
注意：回滚后的旧代码仍用 `kanby-recovery-v1`，与新代码互不兼容，但两者都是同一
制品内部签名和校验，所以回滚本身不需要改 schedule。
