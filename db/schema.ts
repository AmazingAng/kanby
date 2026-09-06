import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    note: text('note').notNull().default(''),
    tag: text('tag').notNull().default('产品'),
    ownerId: text('owner_id').notNull(),
    ownerLogin: text('owner_login').notNull(),
    ownerName: text('owner_name').notNull(),
    ownerAvatarUrl: text('owner_avatar_url'),
    due: text('due'),
    status: text('status').notNull().default('ideas'),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    createdBy: text('created_by').notNull(),
  },
  (table) => [
    index('idx_tasks_status_position').on(table.status, table.position),
    index('idx_tasks_owner_id').on(table.ownerId),
  ],
);

export const createTasksTableSql = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    tag TEXT NOT NULL DEFAULT '产品',
    owner_id TEXT NOT NULL,
    owner_login TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    owner_avatar_url TEXT,
    due TEXT,
    status TEXT NOT NULL DEFAULT 'ideas',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT NOT NULL
  )
`;

export const createStatusPositionIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_tasks_status_position
  ON tasks(status, position)
`;

export const createOwnerIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_tasks_owner_id
  ON tasks(owner_id)
`;
