import { env } from 'cloudflare:workers';

import {
  createOwnerIndexSql,
  createStatusPositionIndexSql,
  createTasksTableSql,
} from '@/db/schema';
import type { AuthUser } from '@/lib/auth';

export type ColumnId = 'ideas' | 'building' | 'shipped';
export type TaskTag = '产品' | '设计' | '代码' | '增长';

export type TaskRecord = {
  id: string;
  title: string;
  note: string;
  tag: TaskTag;
  owner: AuthUser;
  due?: string;
  status: ColumnId;
  position: number;
};

type TaskRow = {
  id: string;
  title: string;
  note: string;
  tag: TaskTag;
  owner_id: string;
  owner_login: string;
  owner_name: string;
  owner_avatar_url: string | null;
  due: string | null;
  status: ColumnId;
  position: number;
};

type DbBindings = { DB?: D1Database };
let schemaReady: Promise<void> | null = null;

const seedTasks: TaskRecord[] = [
  { id: 'task-1', title: '梳理新用户 onboarding', note: '把首次价值体验压缩到 60 秒内', tag: '产品', owner: { id: 'seed-lin', login: 'lin', name: 'Lin', avatarUrl: null }, due: '今天', status: 'building', position: 0 },
  { id: 'task-2', title: '实现 Command 菜单', note: '⌘K 快速创建与跳转', tag: '代码', owner: { id: 'seed-you', login: 'you', name: 'You', avatarUrl: null }, due: '周五', status: 'building', position: 1 },
  { id: 'task-3', title: '重写定价页标题', note: '说人话，少一点功能列表', tag: '增长', owner: { id: 'seed-mika', login: 'mika', name: 'Mika', avatarUrl: null }, status: 'ideas', position: 0 },
  { id: 'task-4', title: '空状态插画', note: '只保留一个让人行动的提示', tag: '设计', owner: { id: 'seed-lin', login: 'lin', name: 'Lin', avatarUrl: null }, due: '下周一', status: 'ideas', position: 1 },
  { id: 'task-5', title: '接入错误监控', note: '生产环境异常自动聚合', tag: '代码', owner: { id: 'seed-you', login: 'you', name: 'You', avatarUrl: null }, status: 'ideas', position: 2 },
  { id: 'task-6', title: '邀请 5 位种子用户', note: '记录首次使用的卡点', tag: '增长', owner: { id: 'seed-mika', login: 'mika', name: 'Mika', avatarUrl: null }, status: 'shipped', position: 0 },
  { id: 'task-7', title: '发布 v0.1', note: '核心流程可以稳定跑通', tag: '产品', owner: { id: 'seed-you', login: 'you', name: 'You', avatarUrl: null }, status: 'shipped', position: 1 },
];

function database(): D1Database {
  const db = (env as unknown as DbBindings).DB;
  if (!db) throw new Error('D1 binding DB is unavailable');
  return db;
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  const db = database();
  schemaReady = (async () => {
    await db.batch([
      db.prepare(createTasksTableSql),
      db.prepare(createStatusPositionIndexSql),
      db.prepare(createOwnerIndexSql),
    ]);
    const count = await db.prepare('SELECT COUNT(*) AS count FROM tasks').first<{ count: number }>();
    if (Number(count?.count ?? 0) === 0) {
      const now = Date.now();
      await db.batch(
        seedTasks.map((task) =>
          db
            .prepare(
              `INSERT OR IGNORE INTO tasks
                (id, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, created_at, updated_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(task.id, task.title, task.note, task.tag, task.owner.id, task.owner.login, task.owner.name, task.owner.avatarUrl, task.due ?? null, task.status, task.position, now, now, task.owner.id),
        ),
      );
    }
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    tag: row.tag,
    owner: { id: row.owner_id, login: row.owner_login, name: row.owner_name, avatarUrl: row.owner_avatar_url },
    due: row.due ?? undefined,
    status: row.status,
    position: row.position,
  };
}

export async function listTasks(): Promise<TaskRecord[]> {
  await ensureSchema();
  const result = await database()
    .prepare(`SELECT id, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position FROM tasks ORDER BY CASE status WHEN 'ideas' THEN 0 WHEN 'building' THEN 1 ELSE 2 END, position ASC`)
    .all<TaskRow>();
  return result.results.map(mapTask);
}

export async function createTask(user: AuthUser, input: { title: string; status: ColumnId }): Promise<TaskRecord> {
  await ensureSchema();
  const db = database();
  const positionRow = await db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE status = ?').bind(input.status).first<{ position: number }>();
  const task: TaskRecord = {
    id: crypto.randomUUID(),
    title: input.title,
    note: '刚刚创建，补充一点上下文吧',
    tag: '产品',
    owner: user,
    status: input.status,
    position: Number(positionRow?.position ?? 0),
  };
  const now = Date.now();
  await db.prepare(
    `INSERT INTO tasks
      (id, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(task.id, task.title, task.note, task.tag, user.id, user.login, user.name, user.avatarUrl, null, task.status, task.position, now, now, user.id).run();
  return task;
}

export async function reorderTasks(items: { id: string; status: ColumnId; position: number }[]): Promise<void> {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  await db.batch(items.map((item) => db.prepare('UPDATE tasks SET status = ?, position = ?, updated_at = ? WHERE id = ?').bind(item.status, item.position, now, item.id)));
}
