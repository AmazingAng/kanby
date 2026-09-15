import { env } from 'cloudflare:workers';

import type { AuthUser } from '@/lib/auth';
import type { TaskAgentState } from '@/lib/task-activity';

export type ColumnId = 'ideas' | 'building' | 'shipped';
export type TaskTag = '产品' | '设计' | '代码' | '增长';
export type ProjectRole = 'owner' | 'member';

export type TaskActivityActor = {
  actorId: string;
  actorName: string;
  actorLogin: string;
  actorAvatarUrl: string | null;
  source?: 'user' | 'agent';
};

export type TaskRecord = {
  id: string;
  number?: number;
  title: string;
  note: string;
  tag: TaskTag;
  owner: AuthUser;
  owners: AuthUser[];
  due?: string;
  status: ColumnId;
  position: number;
  updatedAt: number;
  archivedAt?: number;
  parent?: {
    id: string;
    title: string;
    archived: boolean;
  };
  attachments: TaskAttachmentRecord[];
  acceptanceCriteria: TaskAcceptanceCriterionRecord[];
  githubLink?: TaskGitHubLinkRecord;
  agentState?: Omit<TaskAgentState, 'taskId'>;
};

export type TaskAcceptanceCriterionRecord = {
  id: string;
  body: string;
  completed: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
};

export type TaskGitHubLinkRecord = {
  repository: string;
  kind: 'issue' | 'pull_request';
  number: number;
  url: string;
  title: string;
  state: string;
  ciStatus: string | null;
};

export type TaskAttachmentRecord = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: number;
  url: string;
};

export type StoredTaskAttachment = TaskAttachmentRecord & {
  projectId: string;
  taskId: string;
  objectKey: string;
};

export type ProjectRecord = {
  id: string;
  name: string;
  slug: string;
  role: ProjectRole;
  memberCount: number;
  taskCount: number;
  shippedCount: number;
  updatedAt: number;
};

export type ProjectMemberRecord = {
  id: string;
  login: string;
  name: string;
  avatarUrl: string | null;
  role: ProjectRole;
  pending?: boolean;
};

type TaskRow = {
  id: string;
  task_number: number | null;
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
  updated_at: number;
  archived_at: number | null;
  parent_task_id: string | null;
};

type ParentTaskRow = {
  id: string;
  title: string;
  archived_at: number | null;
};

type TaskAttachmentRow = {
  id: string;
  project_id: string;
  task_id: string;
  object_key: string;
  file_name: string;
  content_type: string;
  size: number;
  created_at: number;
};

type TaskAcceptanceCriterionRow = {
  id: string;
  task_id: string;
  body: string;
  completed: number;
  position: number;
  created_at: number;
  updated_at: number;
};

type TaskAssigneeRow = {
  task_id: string;
  user_id: string;
  login: string;
  name: string;
  avatar_url: string | null;
  position: number;
};

type TaskGitHubLinkRow = {
  task_id: string;
  full_name: string;
  kind: 'issue' | 'pull_request';
  item_number: number;
  url: string;
  title: string;
  state: string;
  ci_status: string | null;
};

type DbBindings = { DB?: D1Database };

export function database(): D1Database {
  const db = (env as unknown as DbBindings).DB;
  if (!db) throw new Error('D1 binding DB is unavailable');
  return db;
}

function projectSlugBase(name: string, id: string) {
  const normalized = name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  const slug = normalized || `project-${id.slice(0, 8)}`;
  return new Set(['api', 'demo', '_next']).has(slug) ? `project-${slug}` : slug;
}

async function uniqueProjectSlug(db: D1Database, name: string, id: string) {
  const base = projectSlugBase(name, id);
  const existing = await db
    .prepare('SELECT id FROM projects WHERE slug = ? AND id != ? LIMIT 1')
    .bind(base, id)
    .first<{ id: string }>();
  return existing ? `${base.slice(0, 47)}-${id.slice(0, 8)}` : base;
}

export async function ensureSchema(): Promise<void> {
  database();
}

function mapAttachment(row: TaskAttachmentRow): StoredTaskAttachment {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    objectKey: row.object_key,
    name: row.file_name,
    contentType: row.content_type,
    size: Number(row.size),
    createdAt: Number(row.created_at),
    url: `/api/attachments?id=${encodeURIComponent(row.id)}`,
  };
}

function mapAcceptanceCriterion(
  row: TaskAcceptanceCriterionRow,
): TaskAcceptanceCriterionRecord {
  return {
    id: row.id,
    body: row.body,
    completed: Boolean(row.completed),
    position: Number(row.position),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapTaskAssignee(row: TaskAssigneeRow): AuthUser {
  return {
    id: row.user_id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
  };
}

function mapTask(
  row: TaskRow,
  attachments: TaskAttachmentRecord[] = [],
  acceptanceCriteria: TaskAcceptanceCriterionRecord[] = [],
  assignees: AuthUser[] = [],
  githubLink?: TaskGitHubLinkRecord,
  agentState?: Omit<TaskAgentState, 'taskId'>,
  parent?: ParentTaskRow,
): TaskRecord {
  const legacyOwner: AuthUser = {
    id: row.owner_id,
    login: row.owner_login,
    name: row.owner_name,
    avatarUrl: row.owner_avatar_url,
  };
  const owners = assignees.length > 0 ? assignees : [legacyOwner];
  return {
    id: row.id,
    number: row.task_number == null ? undefined : Number(row.task_number),
    title: row.title,
    note: row.note,
    tag: row.tag,
    owner: owners[0] ?? legacyOwner,
    owners,
    due: row.due ?? undefined,
    status: row.status,
    position: row.position,
    updatedAt: Number(row.updated_at),
    archivedAt: row.archived_at == null ? undefined : Number(row.archived_at),
    parent: parent
      ? {
          id: parent.id,
          title: parent.title,
          archived: parent.archived_at !== null,
        }
      : undefined,
    attachments,
    acceptanceCriteria,
    githubLink,
    agentState,
  };
}

function mapTaskGitHubLink(row: TaskGitHubLinkRow): TaskGitHubLinkRecord {
  return {
    repository: row.full_name,
    kind: row.kind,
    number: Number(row.item_number),
    url: row.url,
    title: row.title,
    state: row.state,
    ciStatus: row.ci_status,
  };
}

export async function hasPendingProjectInvitation(
  username: string,
  emails: string[],
): Promise<boolean> {
  await ensureSchema();
  const identities = [username, ...emails]
    .map((identity) => identity.trim().toLowerCase())
    .filter(Boolean);
  if (identities.length === 0) return false;
  const placeholders = identities.map(() => '?').join(', ');
  const row = await database()
    .prepare(
      `SELECT 1 AS found FROM project_invitations WHERE accepted_at IS NULL AND identity IN (${placeholders}) LIMIT 1`,
    )
    .bind(...identities)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export async function hasActiveProjectMembership(
  userId: string,
): Promise<boolean> {
  await ensureSchema();
  const row = await database()
    .prepare('SELECT 1 AS found FROM project_members WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export async function registerUserAndAcceptInvitations(
  user: AuthUser,
  emails: string[] = [],
): Promise<void> {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, login, name, avatar_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`,
    )
    .bind(
      user.id,
      user.login.toLowerCase(),
      user.name,
      user.avatarUrl,
      now,
      now,
    )
    .run();

  const identities = [user.login, ...emails]
    .map((identity) => identity.trim().toLowerCase())
    .filter(Boolean);
  if (identities.length > 0) {
    const placeholders = identities.map(() => '?').join(', ');
    const invitations = await db
      .prepare(
        `SELECT id, project_id FROM project_invitations WHERE accepted_at IS NULL AND identity IN (${placeholders})`,
      )
      .bind(...identities)
      .all<{ id: string; project_id: string }>();
    if (invitations.results.length > 0) {
      await db.batch(
        invitations.results.flatMap((invitation) => [
          db
            .prepare(
              'INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
            )
            .bind(invitation.project_id, user.id, 'member', now),
          db
            .prepare(
              'UPDATE project_invitations SET accepted_at = ? WHERE id = ?',
            )
            .bind(now, invitation.id),
        ]),
      );
    }
  }

  const membership = await db
    .prepare('SELECT 1 AS found FROM project_members WHERE user_id = ? LIMIT 1')
    .bind(user.id)
    .first<{ found: number }>();
  if (!membership?.found) {
    const legacy = await db
      .prepare("SELECT owner_id FROM projects WHERE id = 'legacy'")
      .first<{ owner_id: string | null }>();
    if (legacy && !legacy.owner_id) {
      await db.batch([
        db
          .prepare(
            "UPDATE projects SET owner_id = ?, updated_at = ? WHERE id = 'legacy' AND owner_id IS NULL",
          )
          .bind(user.id, now),
        db
          .prepare(
            "INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES ('legacy', ?, 'owner', ?)",
          )
          .bind(user.id, now),
      ]);
    }
  }
}

export async function listProjects(userId: string): Promise<ProjectRecord[]> {
  await ensureSchema();
  const result = await database()
    .prepare(
      `SELECT p.id, p.name, p.slug, pm.role, p.updated_at,
       (SELECT COUNT(*) FROM project_members all_members WHERE all_members.project_id = p.id) AS member_count,
       (SELECT COUNT(*) FROM tasks project_tasks WHERE project_tasks.project_id = p.id AND project_tasks.archived_at IS NULL) AS task_count,
       (SELECT COUNT(*) FROM tasks shipped_tasks WHERE shipped_tasks.project_id = p.id AND shipped_tasks.archived_at IS NULL AND shipped_tasks.status = 'shipped') AS shipped_count
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     ORDER BY p.updated_at DESC`,
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      slug: string;
      role: ProjectRole;
      updated_at: number;
      member_count: number;
      task_count: number;
      shipped_count: number;
    }>();
  return result.results.map((project) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
    role: project.role,
    memberCount: Number(project.member_count),
    taskCount: Number(project.task_count),
    shippedCount: Number(project.shipped_count),
    updatedAt: Number(project.updated_at),
  }));
}

export async function createProject(
  user: AuthUser,
  name: string,
): Promise<ProjectRecord> {
  await registerUserAndAcceptInvitations(user);
  const db = database();
  const id = crypto.randomUUID();
  const slug = await uniqueProjectSlug(db, name, id);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        'INSERT INTO projects (id, name, slug, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(id, name, slug, user.id, now, now),
    db
      .prepare(
        "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
      )
      .bind(id, user.id, now),
  ]);
  return {
    id,
    name,
    slug,
    role: 'owner',
    memberCount: 1,
    taskCount: 0,
    shippedCount: 0,
    updatedAt: now,
  };
}

export async function renameProject(
  projectId: string,
  name: string,
): Promise<void> {
  await ensureSchema();
  await database()
    .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, Date.now(), projectId)
    .run();
}

export async function getProjectRole(
  projectId: string,
  userId: string,
): Promise<ProjectRole | null> {
  await ensureSchema();
  const membership = await database()
    .prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
    )
    .bind(projectId, userId)
    .first<{ role: ProjectRole }>();
  return membership?.role ?? null;
}

export async function listProjectMembers(
  projectId: string,
): Promise<ProjectMemberRecord[]> {
  await ensureSchema();
  const db = database();
  const [members, invitations] = await Promise.all([
    db
      .prepare(
        `SELECT u.id, u.login, u.name, u.avatar_url, pm.role
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ? ORDER BY CASE pm.role WHEN 'owner' THEN 0 ELSE 1 END, pm.created_at`,
      )
      .bind(projectId)
      .all<{
        id: string;
        login: string;
        name: string;
        avatar_url: string | null;
        role: ProjectRole;
      }>(),
    db
      .prepare(
        'SELECT id, identity FROM project_invitations WHERE project_id = ? AND accepted_at IS NULL ORDER BY created_at',
      )
      .bind(projectId)
      .all<{ id: string; identity: string }>(),
  ]);
  return [
    ...members.results.map((member) => ({
      id: member.id,
      login: member.login,
      name: member.name,
      avatarUrl: member.avatar_url,
      role: member.role,
    })),
    ...invitations.results.map((invitation) => ({
      id: `invite:${invitation.id}`,
      login: invitation.identity,
      name: invitation.identity,
      avatarUrl: null,
      role: 'member' as const,
      pending: true,
    })),
  ];
}

export async function inviteProjectMember(
  projectId: string,
  invitedBy: string,
  identity: string,
): Promise<void> {
  await ensureSchema();
  const normalized = identity.trim().toLowerCase().replace(/^@/, '');
  const db = database();
  const existingUser = normalized.includes('@')
    ? null
    : await db
        .prepare('SELECT id FROM users WHERE login = ?')
        .bind(normalized)
        .first<{ id: string }>();
  const now = Date.now();
  if (existingUser) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)",
      )
      .bind(projectId, existingUser.id, now)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO project_invitations (id, project_id, identity, invited_by, created_at, accepted_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(project_id, identity) DO UPDATE SET invited_by = excluded.invited_by, created_at = excluded.created_at, accepted_at = NULL`,
    )
    .bind(crypto.randomUUID(), projectId, normalized, invitedBy, now)
    .run();
}

export async function removeProjectMember(
  projectId: string,
  memberId: string,
): Promise<void> {
  await ensureSchema();
  const db = database();
  if (memberId.startsWith('invite:')) {
    await db
      .prepare(
        'DELETE FROM project_invitations WHERE project_id = ? AND id = ?',
      )
      .bind(projectId, memberId.slice(7))
      .run();
    return;
  }
  await db
    .prepare(
      "DELETE FROM project_members WHERE project_id = ? AND user_id = ? AND role != 'owner'",
    )
    .bind(projectId, memberId)
    .run();
}

export async function listTasks(
  projectId: string,
  archived = false,
): Promise<TaskRecord[]> {
  await ensureSchema();
  const db = database();
  const [
    result,
    attachmentResult,
    acceptanceResult,
    assigneeResult,
    linkResult,
    parentResult,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT id, task_number, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, updated_at, archived_at, parent_task_id
         FROM tasks
         WHERE project_id = ? AND archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
         ORDER BY ${archived ? 'archived_at DESC' : "CASE status WHEN 'ideas' THEN 0 WHEN 'building' THEN 1 ELSE 2 END, position ASC"}`,
      )
      .bind(projectId)
      .all<TaskRow>(),
    db
      .prepare(
        'SELECT id, project_id, task_id, object_key, file_name, content_type, size, created_at FROM task_attachments WHERE project_id = ? ORDER BY created_at ASC',
      )
      .bind(projectId)
      .all<TaskAttachmentRow>(),
    db
      .prepare(
        'SELECT id, task_id, body, completed, position, created_at, updated_at FROM task_acceptance_items WHERE project_id = ? ORDER BY task_id, position, created_at, id',
      )
      .bind(projectId)
      .all<TaskAcceptanceCriterionRow>(),
    db
      .prepare(
        `SELECT ta.task_id, ta.user_id, u.login, u.name, u.avatar_url, ta.position
           FROM task_assignees ta JOIN users u ON u.id = ta.user_id
           WHERE ta.project_id = ?
           ORDER BY ta.task_id, ta.position, ta.created_at, ta.user_id`,
      )
      .bind(projectId)
      .all<TaskAssigneeRow>(),
    db
      .prepare(
        `SELECT gtl.task_id, gr.full_name, gtl.kind, gtl.item_number, gtl.url, gtl.title, gtl.state, gtl.ci_status
       FROM github_task_links gtl JOIN github_repositories gr ON gr.id = gtl.repository_id WHERE gtl.project_id = ?`,
      )
      .bind(projectId)
      .all<TaskGitHubLinkRow>(),
    db
      .prepare('SELECT id, title, archived_at FROM tasks WHERE project_id = ?')
      .bind(projectId)
      .all<ParentTaskRow>(),
  ]);
  const attachmentsByTask = new Map<string, TaskAttachmentRecord[]>();
  for (const row of attachmentResult.results) {
    const attachment = mapAttachment(row);
    const current = attachmentsByTask.get(row.task_id) ?? [];
    current.push(attachment);
    attachmentsByTask.set(row.task_id, current);
  }
  const linksByTask = new Map(
    linkResult.results.map((row) => [row.task_id, mapTaskGitHubLink(row)]),
  );
  const acceptanceByTask = new Map<string, TaskAcceptanceCriterionRecord[]>();
  for (const row of acceptanceResult.results) {
    const items = acceptanceByTask.get(row.task_id) ?? [];
    items.push(mapAcceptanceCriterion(row));
    acceptanceByTask.set(row.task_id, items);
  }
  const assigneesByTask = new Map<string, AuthUser[]>();
  for (const row of assigneeResult.results) {
    const owners = assigneesByTask.get(row.task_id) ?? [];
    owners.push(mapTaskAssignee(row));
    assigneesByTask.set(row.task_id, owners);
  }
  const parentsById = new Map(parentResult.results.map((row) => [row.id, row]));
  const { listProjectAgentStates } = await import('@/lib/task-activity');
  const agentStates = archived ? [] : await listProjectAgentStates(projectId);
  const agentStatesByTask = new Map(
    agentStates.map(({ taskId, ...state }) => [taskId, state]),
  );
  return result.results.map((row) =>
    mapTask(
      row,
      attachmentsByTask.get(row.id) ?? [],
      acceptanceByTask.get(row.id) ?? [],
      assigneesByTask.get(row.id) ?? [],
      linksByTask.get(row.id),
      agentStatesByTask.get(row.id),
      row.parent_task_id ? parentsById.get(row.parent_task_id) : undefined,
    ),
  );
}

export async function createTask(
  user: AuthUser,
  projectId: string,
  input: { title: string; status: ColumnId; due?: string },
  activityActor?: TaskActivityActor,
): Promise<TaskRecord> {
  await ensureSchema();
  const db = database();
  const now = Date.now();
  const [positionRow, numberRow] = await Promise.all([
    db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE project_id = ? AND status = ? AND archived_at IS NULL',
      )
      .bind(projectId, input.status)
      .first<{ position: number }>(),
    db
      .prepare(
        'SELECT COALESCE(MAX(task_number), 0) + 1 AS task_number FROM tasks WHERE project_id = ?',
      )
      .bind(projectId)
      .first<{ task_number: number }>(),
  ]);
  const task: TaskRecord = {
    id: crypto.randomUUID(),
    number: Number(numberRow?.task_number ?? 1),
    title: input.title,
    note: '刚刚创建，补充一点上下文吧',
    tag: '产品',
    due: input.due || undefined,
    owner: user,
    owners: [user],
    status: input.status,
    position: Number(positionRow?.position ?? 0),
    updatedAt: now,
    attachments: [],
    acceptanceCriteria: [],
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO tasks
        (id, project_id, task_number, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, created_at, updated_at, created_by)
       VALUES (?, ?, (SELECT COALESCE(MAX(task_number), 0) + 1 FROM tasks WHERE project_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        task.id,
        projectId,
        projectId,
        task.title,
        task.note,
        task.tag,
        user.id,
        user.login,
        user.name,
        user.avatarUrl,
        task.due ?? null,
        task.status,
        task.position,
        now,
        now,
        user.id,
      ),
    db
      .prepare(
        `INSERT INTO task_assignees (project_id, task_id, user_id, position, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .bind(projectId, task.id, user.id, now),
    db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .bind(now, projectId),
  ];
  if (activityActor) {
    const { prepareTaskActivityStatement } =
      await import('@/lib/task-activity');
    statements.push(
      prepareTaskActivityStatement(db, {
        projectId,
        taskId: task.id,
        source: 'user',
        kind: 'task.created',
        ...activityActor,
        summary: `${activityActor.actorName} 创建了任务`,
        metadata: { status: input.status },
        createdAt: now,
      }),
    );
  }
  await db.batch(statements);
  return task;
}

export class TaskRevisionConflictError extends Error {
  readonly currentUpdatedAt: number;

  constructor(currentUpdatedAt: number) {
    super('Task was changed by another user or agent');
    this.name = 'TaskRevisionConflictError';
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

export class TaskClaimConflictError extends Error {
  constructor() {
    super('Task is actively claimed by another Agent Token');
    this.name = 'TaskClaimConflictError';
  }
}

export class TaskHierarchyError extends Error {
  constructor() {
    super('Nested tasks cannot be split');
    this.name = 'TaskHierarchyError';
  }
}

export class AcceptanceCriterionRevisionConflictError extends Error {
  readonly currentUpdatedAt: number;
  readonly currentTaskUpdatedAt: number;

  constructor(currentUpdatedAt: number, currentTaskUpdatedAt: number) {
    super('Acceptance criterion was changed by another user');
    this.name = 'AcceptanceCriterionRevisionConflictError';
    this.currentUpdatedAt = currentUpdatedAt;
    this.currentTaskUpdatedAt = currentTaskUpdatedAt;
  }
}

export class AcceptanceCriteriaLimitError extends Error {
  constructor() {
    super('A task can have at most 20 acceptance criteria');
    this.name = 'AcceptanceCriteriaLimitError';
  }
}

async function acceptanceResult(projectId: string, taskId: string) {
  const db = database();
  const [task, items] = await Promise.all([
    db
      .prepare(
        'SELECT updated_at FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL',
      )
      .bind(taskId, projectId)
      .first<{ updated_at: number }>(),
    db
      .prepare(
        'SELECT id, task_id, body, completed, position, created_at, updated_at FROM task_acceptance_items WHERE task_id = ? AND project_id = ? ORDER BY position, created_at, id',
      )
      .bind(taskId, projectId)
      .all<TaskAcceptanceCriterionRow>(),
  ]);
  if (!task) return null;
  return {
    acceptanceCriteria: items.results.map(mapAcceptanceCriterion),
    taskUpdatedAt: Number(task.updated_at),
  };
}

async function diagnoseAcceptanceConflict(
  projectId: string,
  taskId: string,
  criterionId?: string,
): Promise<null> {
  const db = database();
  const task = await db
    .prepare(
      'SELECT updated_at FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL',
    )
    .bind(taskId, projectId)
    .first<{ updated_at: number }>();
  if (!task) return null;
  if (criterionId) {
    const item = await db
      .prepare(
        'SELECT updated_at FROM task_acceptance_items WHERE id = ? AND task_id = ? AND project_id = ?',
      )
      .bind(criterionId, taskId, projectId)
      .first<{ updated_at: number }>();
    if (item)
      throw new AcceptanceCriterionRevisionConflictError(
        Number(item.updated_at),
        Number(task.updated_at),
      );
  }
  throw new TaskRevisionConflictError(Number(task.updated_at));
}

export async function createAcceptanceCriterion(
  projectId: string,
  taskId: string,
  body: string,
  expectedTaskUpdatedAt: number,
  actor: TaskActivityActor,
) {
  await ensureSchema();
  const db = database();
  const id = crypto.randomUUID();
  const now = Math.max(Date.now(), expectedTaskUpdatedAt + 1);
  const position = await db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM task_acceptance_items WHERE project_id = ? AND task_id = ?',
    )
    .bind(projectId, taskId)
    .first<{ position: number }>();
  const { prepareTaskActivityStatement } = await import('@/lib/task-activity');
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO task_acceptance_items
         (id, project_id, task_id, body, completed, position, created_by, created_at, updated_at)
         SELECT ?, ?, ?, ?, 0, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM tasks
           WHERE id = ? AND project_id = ? AND archived_at IS NULL AND updated_at = ?
         ) AND (
           SELECT COUNT(*) FROM task_acceptance_items WHERE project_id = ? AND task_id = ?
         ) < 20`,
      )
      .bind(
        id,
        projectId,
        taskId,
        body,
        Number(position?.position ?? 0),
        actor.actorId,
        now,
        now,
        taskId,
        projectId,
        expectedTaskUpdatedAt,
        projectId,
        taskId,
      ),
    db
      .prepare(
        `UPDATE tasks SET updated_at = ?
         WHERE id = ? AND project_id = ? AND archived_at IS NULL AND updated_at = ?
           AND EXISTS (SELECT 1 FROM task_acceptance_items WHERE id = ? AND task_id = ? AND project_id = ?)`,
      )
      .bind(
        now,
        taskId,
        projectId,
        expectedTaskUpdatedAt,
        id,
        taskId,
        projectId,
      ),
    db
      .prepare(
        `UPDATE projects SET updated_at = ? WHERE id = ? AND EXISTS (
           SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND updated_at = ?
         )`,
      )
      .bind(now, projectId, taskId, projectId, now),
    prepareTaskActivityStatement(
      db,
      {
        projectId,
        taskId,
        kind: 'acceptance.created',
        ...actor,
        source: actor.source ?? 'user',
        summary: `${actor.actorName} 添加了验收条件`,
        body,
        createdAt: now,
      },
      { onlyIfTaskUpdatedAt: now },
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0) {
    const task = await db
      .prepare(
        'SELECT updated_at FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL',
      )
      .bind(taskId, projectId)
      .first<{ updated_at: number }>();
    if (!task) return null;
    if (Number(task.updated_at) !== expectedTaskUpdatedAt)
      throw new TaskRevisionConflictError(Number(task.updated_at));
    const count = await db
      .prepare(
        'SELECT COUNT(*) AS count FROM task_acceptance_items WHERE project_id = ? AND task_id = ?',
      )
      .bind(projectId, taskId)
      .first<{ count: number }>();
    if (Number(count?.count ?? 0) >= 20)
      throw new AcceptanceCriteriaLimitError();
    return null;
  }
  return acceptanceResult(projectId, taskId);
}

export async function updateAcceptanceCriterion(
  projectId: string,
  taskId: string,
  input: {
    id: string;
    body?: string;
    completed?: boolean;
    expectedUpdatedAt: number;
    expectedTaskUpdatedAt: number;
  },
  actor: TaskActivityActor,
) {
  await ensureSchema();
  const db = database();
  const current = await db
    .prepare(
      'SELECT body, completed FROM task_acceptance_items WHERE id = ? AND task_id = ? AND project_id = ?',
    )
    .bind(input.id, taskId, projectId)
    .first<{ body: string; completed: number }>();
  if (!current) return null;
  const now = Math.max(
    Date.now(),
    input.expectedUpdatedAt + 1,
    input.expectedTaskUpdatedAt + 1,
  );
  const nextBody = input.body ?? current.body;
  const nextCompleted = input.completed ?? Boolean(current.completed);
  const completionChanged = Boolean(current.completed) !== nextCompleted;
  const { prepareTaskActivityStatement } = await import('@/lib/task-activity');
  const results = await db.batch([
    db
      .prepare(
        `UPDATE task_acceptance_items SET body = ?, completed = ?, updated_at = ?
         WHERE id = ? AND task_id = ? AND project_id = ? AND updated_at = ?
           AND EXISTS (
             SELECT 1 FROM tasks
             WHERE id = ? AND project_id = ? AND archived_at IS NULL AND updated_at = ?
           )`,
      )
      .bind(
        nextBody,
        nextCompleted ? 1 : 0,
        now,
        input.id,
        taskId,
        projectId,
        input.expectedUpdatedAt,
        taskId,
        projectId,
        input.expectedTaskUpdatedAt,
      ),
    db
      .prepare(
        `UPDATE tasks SET updated_at = ?
         WHERE id = ? AND project_id = ? AND archived_at IS NULL AND updated_at = ?
           AND EXISTS (
             SELECT 1 FROM task_acceptance_items
             WHERE id = ? AND task_id = ? AND project_id = ? AND updated_at = ?
           )`,
      )
      .bind(
        now,
        taskId,
        projectId,
        input.expectedTaskUpdatedAt,
        input.id,
        taskId,
        projectId,
        now,
      ),
    db
      .prepare(
        `UPDATE projects SET updated_at = ? WHERE id = ? AND EXISTS (
           SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND updated_at = ?
         )`,
      )
      .bind(now, projectId, taskId, projectId, now),
    prepareTaskActivityStatement(
      db,
      {
        projectId,
        taskId,
        kind: completionChanged
          ? nextCompleted
            ? 'acceptance.completed'
            : 'acceptance.reopened'
          : 'acceptance.updated',
        ...actor,
        source: actor.source ?? 'user',
        summary: completionChanged
          ? `${actor.actorName}${nextCompleted ? '完成' : '重新打开'}了验收条件`
          : `${actor.actorName} 修改了验收条件`,
        body: nextBody,
        createdAt: now,
      },
      { onlyIfTaskUpdatedAt: now },
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0)
    return diagnoseAcceptanceConflict(projectId, taskId, input.id);
  return acceptanceResult(projectId, taskId);
}

export async function deleteAcceptanceCriterion(
  projectId: string,
  taskId: string,
  input: {
    id: string;
    expectedUpdatedAt: number;
    expectedTaskUpdatedAt: number;
  },
  actor: TaskActivityActor,
) {
  await ensureSchema();
  const db = database();
  const current = await db
    .prepare(
      'SELECT body FROM task_acceptance_items WHERE id = ? AND task_id = ? AND project_id = ?',
    )
    .bind(input.id, taskId, projectId)
    .first<{ body: string }>();
  if (!current) return null;
  const now = Math.max(
    Date.now(),
    input.expectedUpdatedAt + 1,
    input.expectedTaskUpdatedAt + 1,
  );
  const { prepareTaskActivityStatement } = await import('@/lib/task-activity');
  const results = await db.batch([
    db
      .prepare(
        `UPDATE tasks SET updated_at = ?
         WHERE id = ? AND project_id = ? AND archived_at IS NULL AND updated_at = ?
           AND EXISTS (
             SELECT 1 FROM task_acceptance_items
             WHERE id = ? AND task_id = ? AND project_id = ? AND updated_at = ?
           )`,
      )
      .bind(
        now,
        taskId,
        projectId,
        input.expectedTaskUpdatedAt,
        input.id,
        taskId,
        projectId,
        input.expectedUpdatedAt,
      ),
    db
      .prepare(
        `DELETE FROM task_acceptance_items
         WHERE id = ? AND task_id = ? AND project_id = ? AND updated_at = ?
           AND EXISTS (
             SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND updated_at = ?
           )`,
      )
      .bind(
        input.id,
        taskId,
        projectId,
        input.expectedUpdatedAt,
        taskId,
        projectId,
        now,
      ),
    db
      .prepare(
        `UPDATE projects SET updated_at = ? WHERE id = ? AND EXISTS (
           SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND updated_at = ?
         )`,
      )
      .bind(now, projectId, taskId, projectId, now),
    prepareTaskActivityStatement(
      db,
      {
        projectId,
        taskId,
        kind: 'acceptance.deleted',
        ...actor,
        source: actor.source ?? 'user',
        summary: `${actor.actorName} 删除了验收条件`,
        body: current.body,
        createdAt: now,
      },
      { onlyIfTaskUpdatedAt: now },
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 0)
    return diagnoseAcceptanceConflict(projectId, taskId, input.id);
  return acceptanceResult(projectId, taskId);
}

export async function splitTask(
  user: AuthUser,
  projectId: string,
  input: {
    parentTaskId: string;
    expectedUpdatedAt: number;
    titles: string[];
  },
  activityActor?: TaskActivityActor & { source?: 'user' | 'agent' },
): Promise<{ tasks: TaskRecord[]; parentUpdatedAt: number } | null> {
  await ensureSchema();
  const db = database();
  const parent = await db
    .prepare(
      `SELECT id, title, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, updated_at, parent_task_id
       FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL`,
    )
    .bind(input.parentTaskId, projectId)
    .first<{
      id: string;
      title: string;
      tag: TaskTag;
      owner_id: string;
      owner_login: string;
      owner_name: string;
      owner_avatar_url: string | null;
      due: string | null;
      updated_at: number;
      parent_task_id: string | null;
    }>();
  if (!parent) return null;
  if (parent.parent_task_id) throw new TaskHierarchyError();
  if (Number(parent.updated_at) !== input.expectedUpdatedAt)
    throw new TaskRevisionConflictError(Number(parent.updated_at));

  const positionRow = await db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE project_id = ? AND status = 'ideas' AND archived_at IS NULL",
    )
    .bind(projectId)
    .first<{ position: number }>();
  const firstPosition = Number(positionRow?.position ?? 0);
  const now = Math.max(Date.now(), Number(parent.updated_at) + 1);
  const taskIds = input.titles.map(() => crypto.randomUUID());
  const statements: D1PreparedStatement[] = input.titles.map((title, index) =>
    db
      .prepare(
        `INSERT INTO tasks
         (id, project_id, task_number, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, created_at, updated_at, created_by, parent_task_id)
         SELECT ?, project_id,
                (SELECT COALESCE(MAX(numbered.task_number), 0) + 1 FROM tasks numbered WHERE numbered.project_id = tasks.project_id),
                ?, '', tag, owner_id, owner_login, owner_name, owner_avatar_url, due, 'ideas', ?, ?, ?, ?, id
         FROM tasks
         WHERE id = ? AND project_id = ? AND archived_at IS NULL AND parent_task_id IS NULL AND updated_at = ?`,
      )
      .bind(
        taskIds[index],
        title,
        firstPosition + index,
        now,
        now,
        user.id,
        input.parentTaskId,
        projectId,
        input.expectedUpdatedAt,
      ),
  );
  for (const taskId of taskIds) {
    statements.push(
      db
        .prepare(
          `INSERT INTO task_assignees (project_id, task_id, user_id, position, created_at)
           SELECT project_id, ?, user_id, position, ? FROM task_assignees
           WHERE task_id = ? AND project_id = ?
             AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND updated_at = ?)`,
        )
        .bind(
          taskId,
          now,
          input.parentTaskId,
          projectId,
          taskId,
          projectId,
          now,
        ),
      db
        .prepare(
          `INSERT INTO task_assignees (project_id, task_id, user_id, position, created_at)
           SELECT project_id, ?, owner_id, 0, ? FROM tasks
           WHERE id = ? AND project_id = ?
             AND NOT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = ? AND project_id = ?)
             AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND updated_at = ?)`,
        )
        .bind(
          taskId,
          now,
          input.parentTaskId,
          projectId,
          input.parentTaskId,
          projectId,
          taskId,
          projectId,
          now,
        ),
    );
  }
  const parentUpdateIndex = statements.length;
  statements.push(
    db
      .prepare(
        'UPDATE tasks SET updated_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NULL AND parent_task_id IS NULL AND updated_at = ?',
      )
      .bind(now, input.parentTaskId, projectId, input.expectedUpdatedAt),
    db
      .prepare(
        `UPDATE projects SET updated_at = ? WHERE id = ? AND EXISTS (
           SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND updated_at = ?
         )`,
      )
      .bind(now, projectId, input.parentTaskId, projectId, now),
  );
  if (activityActor) {
    const { source = 'user', ...actor } = activityActor;
    const { prepareTaskActivityStatement } =
      await import('@/lib/task-activity');
    statements.push(
      prepareTaskActivityStatement(
        db,
        {
          projectId,
          taskId: input.parentTaskId,
          source,
          kind: 'task.split',
          ...actor,
          summary: `${activityActor.actorName} 将任务拆分为 ${input.titles.length} 个子任务`,
          metadata: { count: input.titles.length },
          createdAt: now,
        },
        { onlyIfTaskUpdatedAt: now },
      ),
      ...taskIds.map((taskId) =>
        prepareTaskActivityStatement(
          db,
          {
            projectId,
            taskId,
            source,
            kind: 'task.created',
            ...actor,
            summary: `${activityActor.actorName} 从「${parent.title}」拆分了子任务`,
            metadata: { parentTaskId: input.parentTaskId },
            createdAt: now,
          },
          { onlyIfTaskUpdatedAt: now },
        ),
      ),
    );
  }
  const results = await db.batch(statements);
  if (Number(results[parentUpdateIndex]?.meta.changes ?? 0) === 0) {
    const current = await db
      .prepare('SELECT updated_at FROM tasks WHERE id = ? AND project_id = ?')
      .bind(input.parentTaskId, projectId)
      .first<{ updated_at: number }>();
    if (current)
      throw new TaskRevisionConflictError(Number(current.updated_at));
    return null;
  }

  const activeTasks = await listTasks(projectId);
  const createdById = new Map(activeTasks.map((task) => [task.id, task]));
  return {
    tasks: taskIds.flatMap((taskId) => {
      const task = createdById.get(taskId);
      return task ? [task] : [];
    }),
    parentUpdatedAt: now,
  };
}

export async function updateTask(
  projectId: string,
  input: {
    id: string;
    title: string;
    note: string;
    tag: TaskTag;
    ownerId: string;
    ownerIds?: string[];
    due?: string;
    status: ColumnId;
    expectedUpdatedAt: number;
    agentTokenId?: string;
    activity?: {
      actor: TaskActivityActor;
      editSessionId?: string;
    };
  },
): Promise<TaskRecord | null> {
  await ensureSchema();
  const db = database();
  const existing = await db
    .prepare(
      `SELECT title, note, tag, owner_id, due, status, position, updated_at
       FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL`,
    )
    .bind(input.id, projectId)
    .first<{
      title: string;
      note: string;
      tag: TaskTag;
      owner_id: string;
      due: string | null;
      status: ColumnId;
      position: number;
      updated_at: number;
    }>();
  if (!existing) return null;
  const requestedOwnerIds = input.ownerIds ?? [input.ownerId];
  if (
    requestedOwnerIds.length < 1 ||
    requestedOwnerIds.length > 3 ||
    new Set(requestedOwnerIds).size !== requestedOwnerIds.length
  )
    return null;
  const memberPlaceholders = requestedOwnerIds.map(() => '?').join(', ');
  const ownerResult = await db
    .prepare(
      `SELECT u.id, u.login, u.name, u.avatar_url
     FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? AND pm.user_id IN (${memberPlaceholders})`,
    )
    .bind(projectId, ...requestedOwnerIds)
    .all<{
      id: string;
      login: string;
      name: string;
      avatar_url: string | null;
    }>();
  const ownerById = new Map(
    ownerResult.results.map((owner) => [owner.id, owner]),
  );
  const owners = requestedOwnerIds.flatMap((ownerId) => {
    const owner = ownerById.get(ownerId);
    return owner ? [owner] : [];
  });
  if (owners.length !== requestedOwnerIds.length) return null;
  const owner = owners[0]!;
  const existingAssignees = await db
    .prepare(
      'SELECT user_id FROM task_assignees WHERE task_id = ? AND project_id = ? ORDER BY position, created_at, user_id',
    )
    .bind(input.id, projectId)
    .all<{ user_id: string }>();
  const existingOwnerIds = existingAssignees.results.length
    ? existingAssignees.results.map((assignee) => assignee.user_id)
    : [existing.owner_id];

  let position = Number(existing.position);
  if (existing.status !== input.status) {
    const target = await db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE project_id = ? AND status = ? AND archived_at IS NULL',
      )
      .bind(projectId, input.status)
      .first<{ position: number }>();
    position = Number(target?.position ?? 0);
  }
  const now = Math.max(Date.now(), Number(existing.updated_at) + 1);
  const assigneeRevision = crypto.randomUUID();
  const agentTokenId = input.agentTokenId ?? null;
  const updateStatement = db
    .prepare(
      `UPDATE tasks SET title = ?, note = ?, tag = ?, owner_id = ?, owner_login = ?, owner_name = ?, owner_avatar_url = ?, due = ?, status = ?, position = ?, updated_at = ?, assignee_revision = ?
     WHERE id = ? AND project_id = ? AND updated_at = ? AND archived_at IS NULL
       AND (SELECT COUNT(*) FROM project_members WHERE project_id = ? AND user_id IN (${memberPlaceholders})) = ?
       AND (? IS NULL OR NOT EXISTS (
         SELECT 1 FROM task_agent_claims
         WHERE task_id = ? AND project_id = ? AND lease_expires_at > ? AND token_id != ?
       ))`,
    )
    .bind(
      input.title,
      input.note,
      input.tag,
      owner.id,
      owner.login,
      owner.name,
      owner.avatar_url,
      input.due || null,
      input.status,
      position,
      now,
      assigneeRevision,
      input.id,
      projectId,
      input.expectedUpdatedAt,
      projectId,
      ...requestedOwnerIds,
      requestedOwnerIds.length,
      agentTokenId,
      input.id,
      projectId,
      Date.now(),
      agentTokenId,
    );
  const statements: D1PreparedStatement[] = [
    updateStatement,
    db
      .prepare(
        `DELETE FROM task_assignees WHERE task_id = ? AND project_id = ?
         AND EXISTS (SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND assignee_revision = ?)`,
      )
      .bind(input.id, projectId, input.id, projectId, assigneeRevision),
    ...requestedOwnerIds.map((ownerId, index) =>
      db
        .prepare(
          `INSERT INTO task_assignees (project_id, task_id, user_id, position, created_at)
           SELECT ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND assignee_revision = ?)
             AND EXISTS (SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?)`,
        )
        .bind(
          projectId,
          input.id,
          ownerId,
          index,
          now,
          input.id,
          projectId,
          assigneeRevision,
          projectId,
          ownerId,
        ),
    ),
    db
      .prepare(
        `UPDATE projects SET updated_at = ? WHERE id = ? AND EXISTS (
           SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND assignee_revision = ?
         )`,
      )
      .bind(now, projectId, input.id, projectId, assigneeRevision),
  ];
  if (input.activity) {
    const changedFields = [
      existing.title !== input.title ? 'title' : null,
      existing.note !== input.note ? 'note' : null,
      existing.tag !== input.tag ? 'tag' : null,
      existingOwnerIds.join('\0') !== requestedOwnerIds.join('\0')
        ? 'owners'
        : null,
      (existing.due ?? '') !== (input.due ?? '') ? 'due' : null,
      existing.status !== input.status ? 'status' : null,
    ].filter((field): field is string => Boolean(field));
    if (changedFields.length > 0) {
      const { prepareTaskActivityStatement } =
        await import('@/lib/task-activity');
      statements.push(
        prepareTaskActivityStatement(
          db,
          {
            projectId,
            taskId: input.id,
            source: 'user',
            kind: 'task.updated',
            ...input.activity.actor,
            summary: `${input.activity.actor.actorName} 修改了任务`,
            metadata: { fields: changedFields },
            dedupeKey: input.activity.editSessionId
              ? `edit:${input.id}:${input.activity.actor.actorId}:${input.activity.editSessionId}`
              : null,
            createdAt: now,
          },
          {
            onlyIfTaskUpdatedAt: now,
            onlyIfTaskAssigneeRevision: assigneeRevision,
          },
        ),
      );
    }
  }
  const results = await db.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0) === 0) {
    const current = await db
      .prepare('SELECT updated_at FROM tasks WHERE id = ? AND project_id = ?')
      .bind(input.id, projectId)
      .first<{ updated_at: number }>();
    if (!current) return null;
    if (agentTokenId) {
      const blockingClaim = await db
        .prepare(
          'SELECT 1 AS found FROM task_agent_claims WHERE task_id = ? AND project_id = ? AND lease_expires_at > ? AND token_id != ? LIMIT 1',
        )
        .bind(input.id, projectId, Date.now(), agentTokenId)
        .first<{ found: number }>();
      if (blockingClaim) throw new TaskClaimConflictError();
    }
    throw new TaskRevisionConflictError(Number(current.updated_at));
  }
  const updated = await db
    .prepare(
      'SELECT id, task_number, title, note, tag, owner_id, owner_login, owner_name, owner_avatar_url, due, status, position, updated_at, archived_at, parent_task_id FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL',
    )
    .bind(input.id, projectId)
    .first<TaskRow>();
  if (!updated) return null;
  const attachments = await db
    .prepare(
      'SELECT id, project_id, task_id, object_key, file_name, content_type, size, created_at FROM task_attachments WHERE task_id = ? AND project_id = ? ORDER BY created_at ASC',
    )
    .bind(input.id, projectId)
    .all<TaskAttachmentRow>();
  const acceptanceCriteria = await db
    .prepare(
      'SELECT id, task_id, body, completed, position, created_at, updated_at FROM task_acceptance_items WHERE task_id = ? AND project_id = ? ORDER BY position, created_at, id',
    )
    .bind(input.id, projectId)
    .all<TaskAcceptanceCriterionRow>();
  const assignees = await db
    .prepare(
      `SELECT ta.task_id, ta.user_id, u.login, u.name, u.avatar_url, ta.position
       FROM task_assignees ta JOIN users u ON u.id = ta.user_id
       WHERE ta.task_id = ? AND ta.project_id = ?
       ORDER BY ta.position, ta.created_at, ta.user_id`,
    )
    .bind(input.id, projectId)
    .all<TaskAssigneeRow>();
  const githubLink = await db
    .prepare(
      `SELECT gtl.task_id, gr.full_name, gtl.kind, gtl.item_number, gtl.url, gtl.title, gtl.state, gtl.ci_status
     FROM github_task_links gtl JOIN github_repositories gr ON gr.id = gtl.repository_id WHERE gtl.task_id = ? AND gtl.project_id = ?`,
    )
    .bind(input.id, projectId)
    .first<TaskGitHubLinkRow>();
  const parent = updated.parent_task_id
    ? await db
        .prepare(
          'SELECT id, title, archived_at FROM tasks WHERE id = ? AND project_id = ?',
        )
        .bind(updated.parent_task_id, projectId)
        .first<ParentTaskRow>()
    : null;
  return mapTask(
    updated,
    attachments.results.map(mapAttachment),
    acceptanceCriteria.results.map(mapAcceptanceCriterion),
    assignees.results.map(mapTaskAssignee),
    githubLink ? mapTaskGitHubLink(githubLink) : undefined,
    undefined,
    parent ?? undefined,
  );
}

export async function taskBelongsToProject(
  taskId: string,
  projectId: string,
): Promise<boolean> {
  await ensureSchema();
  const row = await database()
    .prepare(
      'SELECT 1 AS found FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL',
    )
    .bind(taskId, projectId)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export async function countTaskAttachments(
  taskId: string,
  projectId: string,
): Promise<number> {
  await ensureSchema();
  const row = await database()
    .prepare(
      'SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = ? AND project_id = ?',
    )
    .bind(taskId, projectId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function createTaskAttachment(input: {
  projectId: string;
  taskId: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  createdBy: string;
}): Promise<TaskAttachmentRecord | null> {
  await ensureSchema();
  const db = database();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO task_attachments (id, project_id, task_id, object_key, file_name, content_type, size, created_by, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM task_attachments WHERE task_id = ? AND project_id = ?) < 10`,
    )
    .bind(
      id,
      input.projectId,
      input.taskId,
      input.objectKey,
      input.fileName,
      input.contentType,
      input.size,
      input.createdBy,
      createdAt,
      input.taskId,
      input.projectId,
    )
    .run();
  if (Number(result.meta.changes ?? 0) === 0) return null;
  await db
    .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
    .bind(createdAt, input.projectId)
    .run();
  return {
    id,
    name: input.fileName,
    contentType: input.contentType,
    size: input.size,
    createdAt,
    url: `/api/attachments?id=${encodeURIComponent(id)}`,
  };
}

export async function getTaskAttachment(
  id: string,
): Promise<StoredTaskAttachment | null> {
  await ensureSchema();
  const row = await database()
    .prepare(
      'SELECT id, project_id, task_id, object_key, file_name, content_type, size, created_at FROM task_attachments WHERE id = ?',
    )
    .bind(id)
    .first<TaskAttachmentRow>();
  return row ? mapAttachment(row) : null;
}

export async function deleteTaskAttachment(
  id: string,
  projectId: string,
): Promise<StoredTaskAttachment | null> {
  await ensureSchema();
  const db = database();
  const attachment = await getTaskAttachment(id);
  if (!attachment || attachment.projectId !== projectId) return null;
  const now = Date.now();
  await db.batch([
    db
      .prepare('DELETE FROM task_attachments WHERE id = ? AND project_id = ?')
      .bind(id, projectId),
    db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .bind(now, projectId),
  ]);
  return attachment;
}

export async function setTaskArchived(
  projectId: string,
  taskId: string,
  archived: boolean,
  expectedUpdatedAt: number,
  activityActor?: TaskActivityActor,
): Promise<TaskRecord | null> {
  await ensureSchema();
  const db = database();
  const now = Math.max(Date.now(), expectedUpdatedAt + 1);
  const updateStatement = db
    .prepare(
      archived
        ? 'UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NULL AND updated_at = ?'
        : 'UPDATE tasks SET archived_at = NULL, updated_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NOT NULL AND updated_at = ?',
    )
    .bind(
      ...(archived
        ? [now, now, taskId, projectId, expectedUpdatedAt]
        : [now, taskId, projectId, expectedUpdatedAt]),
    );
  const statements: D1PreparedStatement[] = [
    updateStatement,
    ...(archived
      ? [
          db
            .prepare(
              `DELETE FROM task_agent_claims WHERE task_id = ? AND project_id = ?
               AND EXISTS (
                 SELECT 1 FROM tasks WHERE id = ? AND project_id = ?
                   AND archived_at = ? AND updated_at = ?
               )`,
            )
            .bind(taskId, projectId, taskId, projectId, now, now),
        ]
      : []),
    db
      .prepare(
        `UPDATE projects SET updated_at = ? WHERE id = ? AND EXISTS (
           SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND updated_at = ?
         )`,
      )
      .bind(now, projectId, taskId, projectId, now),
  ];
  if (activityActor) {
    const { source = 'user', ...actor } = activityActor;
    const { prepareTaskActivityStatement } =
      await import('@/lib/task-activity');
    statements.push(
      prepareTaskActivityStatement(
        db,
        {
          projectId,
          taskId,
          source,
          kind: archived ? 'task.archived' : 'task.restored',
          ...actor,
          summary: `${activityActor.actorName}${archived ? '归档' : '恢复'}了任务`,
          createdAt: now,
        },
        { onlyIfTaskUpdatedAt: now },
      ),
    );
  }
  const results = await db.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0) === 0) {
    const current = await db
      .prepare('SELECT updated_at FROM tasks WHERE id = ? AND project_id = ?')
      .bind(taskId, projectId)
      .first<{ updated_at: number }>();
    if (current)
      throw new TaskRevisionConflictError(Number(current.updated_at));
    return null;
  }
  return (
    (await listTasks(projectId, archived)).find((task) => task.id === taskId) ??
    null
  );
}

export async function permanentlyDeleteArchivedTask(
  projectId: string,
  taskId: string,
  expectedUpdatedAt: number,
): Promise<string[] | null> {
  await ensureSchema();
  const db = database();
  const task = await db
    .prepare(
      'SELECT updated_at FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NOT NULL',
    )
    .bind(taskId, projectId)
    .first<{ updated_at: number }>();
  if (!task) return null;
  if (Number(task.updated_at) !== expectedUpdatedAt) {
    throw new TaskRevisionConflictError(Number(task.updated_at));
  }
  const attachments = await db
    .prepare(
      'SELECT object_key FROM task_attachments WHERE task_id = ? AND project_id = ?',
    )
    .bind(taskId, projectId)
    .all<{ object_key: string }>();
  const childRevision = await db
    .prepare(
      'SELECT COALESCE(MAX(updated_at), 0) AS updated_at FROM tasks WHERE project_id = ? AND parent_task_id = ?',
    )
    .bind(projectId, taskId)
    .first<{ updated_at: number }>();
  const now = Math.max(Date.now(), Number(childRevision?.updated_at ?? 0) + 1);
  const guard =
    'EXISTS (SELECT 1 FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NOT NULL AND updated_at = ?)';
  const results = await db.batch([
    db
      .prepare(
        `UPDATE tasks SET parent_task_id = NULL, updated_at = ?
         WHERE project_id = ? AND parent_task_id = ? AND ${guard}`,
      )
      .bind(now, projectId, taskId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        `DELETE FROM task_agent_updates WHERE task_id = ? AND project_id = ? AND ${guard}`,
      )
      .bind(taskId, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        `DELETE FROM task_agent_claims WHERE task_id = ? AND project_id = ? AND ${guard}`,
      )
      .bind(taskId, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        `DELETE FROM task_events WHERE task_id = ? AND project_id = ? AND ${guard}`,
      )
      .bind(taskId, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        `DELETE FROM github_issue_imports WHERE task_id = ? AND project_id = ? AND ${guard}`,
      )
      .bind(taskId, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        `DELETE FROM github_task_links WHERE task_id = ? AND project_id = ? AND ${guard}`,
      )
      .bind(taskId, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        `DELETE FROM task_attachments WHERE task_id = ? AND project_id = ? AND ${guard}`,
      )
      .bind(taskId, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        `DELETE FROM task_acceptance_items WHERE task_id = ? AND project_id = ? AND ${guard}`,
      )
      .bind(taskId, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        `DELETE FROM task_assignees WHERE task_id = ? AND project_id = ? AND ${guard}`,
      )
      .bind(taskId, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(`UPDATE projects SET updated_at = ? WHERE id = ? AND ${guard}`)
      .bind(now, projectId, taskId, projectId, expectedUpdatedAt),
    db
      .prepare(
        'DELETE FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NOT NULL AND updated_at = ?',
      )
      .bind(taskId, projectId, expectedUpdatedAt),
  ]);
  if (Number(results.at(-1)?.meta.changes ?? 0) === 0) {
    const current = await db
      .prepare('SELECT updated_at FROM tasks WHERE id = ? AND project_id = ?')
      .bind(taskId, projectId)
      .first<{ updated_at: number }>();
    if (current)
      throw new TaskRevisionConflictError(Number(current.updated_at));
    return null;
  }
  return attachments.results.map((attachment) => attachment.object_key);
}

export async function reorderTasks(
  projectId: string,
  items: { id: string; status: ColumnId; position: number }[],
  activity?: { movedTaskId: string; actor: TaskActivityActor },
): Promise<void> {
  await ensureSchema();
  const db = database();
  const movedBefore = activity
    ? await db
        .prepare(
          'SELECT status, updated_at FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL',
        )
        .bind(activity.movedTaskId, projectId)
        .first<{ status: ColumnId; updated_at: number }>()
    : null;
  const movedAfter = activity
    ? items.find((item) => item.id === activity.movedTaskId)
    : undefined;
  const now = Math.max(
    Date.now(),
    movedBefore ? Number(movedBefore.updated_at) + 1 : 0,
  );
  const statements: D1PreparedStatement[] = [
    ...items.map((item) =>
      db
        .prepare(
          'UPDATE tasks SET status = ?, position = ?, updated_at = ? WHERE id = ? AND project_id = ? AND archived_at IS NULL',
        )
        .bind(item.status, item.position, now, item.id, projectId),
    ),
    db
      .prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
      .bind(now, projectId),
  ];
  if (
    activity &&
    movedBefore &&
    movedAfter &&
    movedBefore.status !== movedAfter.status
  ) {
    const { prepareTaskActivityStatement } =
      await import('@/lib/task-activity');
    statements.push(
      prepareTaskActivityStatement(
        db,
        {
          projectId,
          taskId: activity.movedTaskId,
          source: 'user',
          kind: 'task.moved',
          ...activity.actor,
          summary: `${activity.actor.actorName} 移动了任务`,
          metadata: {
            from: movedBefore.status,
            to: movedAfter.status,
          },
          createdAt: now,
        },
        { onlyIfTaskUpdatedAt: now },
      ),
    );
  }
  await db.batch(statements);
}
