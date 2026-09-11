import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    login: text('login').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_users_login').on(table.login)],
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug'),
    ownerId: text('owner_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_projects_slug').on(table.slug)],
);

export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull().default('member'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_project_members_project_user').on(
      table.projectId,
      table.userId,
    ),
    index('idx_project_members_user').on(table.userId, table.projectId),
  ],
);

export const projectInvitations = sqliteTable(
  'project_invitations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    identity: text('identity').notNull(),
    invitedBy: text('invited_by').notNull(),
    createdAt: integer('created_at').notNull(),
    acceptedAt: integer('accepted_at'),
  },
  (table) => [
    uniqueIndex('idx_project_invitations_project_identity').on(
      table.projectId,
      table.identity,
    ),
    index('idx_project_invitations_identity').on(
      table.identity,
      table.acceptedAt,
    ),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    taskNumber: integer('task_number'),
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
    assigneeRevision: text('assignee_revision'),
    archivedAt: integer('archived_at'),
    createdBy: text('created_by').notNull(),
    parentTaskId: text('parent_task_id'),
  },
  (table) => [
    index('idx_tasks_project_status_position').on(
      table.projectId,
      table.status,
      table.position,
    ),
    index('idx_tasks_owner_id').on(table.ownerId),
    index('idx_tasks_project_archived').on(table.projectId, table.archivedAt),
    index('idx_tasks_project_parent').on(table.projectId, table.parentTaskId),
    uniqueIndex('idx_tasks_project_number').on(
      table.projectId,
      table.taskNumber,
    ),
  ],
);

export const taskAttachments = sqliteTable(
  'task_attachments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    taskId: text('task_id').notNull(),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_task_attachments_object_key').on(table.objectKey),
    index('idx_task_attachments_project_task').on(
      table.projectId,
      table.taskId,
      table.createdAt,
    ),
  ],
);

export const taskAcceptanceItems = sqliteTable(
  'task_acceptance_items',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    completed: integer('completed').notNull().default(0),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_task_acceptance_project_task_position').on(
      table.projectId,
      table.taskId,
      table.position,
      table.createdAt,
    ),
  ],
);

export const taskAssignees = sqliteTable(
  'task_assignees',
  {
    projectId: text('project_id').notNull(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_task_assignees_task_user').on(table.taskId, table.userId),
    index('idx_task_assignees_project_task_position').on(
      table.projectId,
      table.taskId,
      table.position,
    ),
  ],
);

export const githubInstallations = sqliteTable(
  'github_installations',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    repositorySelection: text('repository_selection').notNull(),
    htmlUrl: text('html_url'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_github_installations_account').on(table.accountId)],
);

export const githubProjectInstallations = sqliteTable(
  'github_project_installations',
  {
    projectId: text('project_id').primaryKey(),
    installationId: text('installation_id').notNull(),
    connectedBy: text('connected_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_github_project_installations_installation').on(
      table.installationId,
    ),
  ],
);

export const githubRepositories = sqliteTable(
  'github_repositories',
  {
    id: text('id').primaryKey(),
    installationId: text('installation_id').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    htmlUrl: text('html_url').notNull(),
    defaultBranch: text('default_branch').notNull(),
    private: integer('private').notNull().default(0),
    active: integer('active').notNull().default(1),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_github_repositories_installation').on(table.installationId),
    uniqueIndex('idx_github_repositories_full_name').on(table.fullName),
  ],
);

export const githubProjectRepositories = sqliteTable(
  'github_project_repositories',
  {
    projectId: text('project_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_github_project_repositories_pair').on(
      table.projectId,
      table.repositoryId,
    ),
    index('idx_github_project_repositories_repository').on(
      table.repositoryId,
      table.projectId,
    ),
  ],
);

export const githubTaskLinks = sqliteTable(
  'github_task_links',
  {
    taskId: text('task_id').primaryKey(),
    projectId: text('project_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    kind: text('kind').notNull(),
    itemNumber: integer('item_number').notNull(),
    branch: text('branch'),
    url: text('url').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    ciStatus: text('ci_status'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_github_task_links_project').on(table.projectId, table.updatedAt),
    index('idx_github_task_links_item').on(
      table.repositoryId,
      table.kind,
      table.itemNumber,
    ),
  ],
);

export const githubEvents = sqliteTable(
  'github_events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    kind: text('kind').notNull(),
    action: text('action').notNull(),
    itemNumber: integer('item_number'),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    url: text('url'),
    actorLogin: text('actor_login').notNull(),
    actorAvatarUrl: text('actor_avatar_url'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_github_events_project_created').on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const githubAutomationSettings = sqliteTable(
  'github_automation_settings',
  {
    projectId: text('project_id').primaryKey(),
    issueTaskCreation: integer('issue_task_creation').notNull().default(1),
    autoLinkPullRequests: integer('auto_link_pull_requests')
      .notNull()
      .default(1),
    pullRequestOpenStatus: text('pull_request_open_status').default('building'),
    completionStatus: text('completion_status').default('shipped'),
    showCiFailures: integer('show_ci_failures').notNull().default(1),
    updatedBy: text('updated_by').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_github_automation_updated').on(table.updatedAt)],
);

export const githubIssueImports = sqliteTable(
  'github_issue_imports',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    repositoryId: text('repository_id').notNull(),
    itemNumber: integer('item_number').notNull(),
    taskId: text('task_id').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_github_issue_imports_item').on(
      table.projectId,
      table.repositoryId,
      table.itemNumber,
    ),
    uniqueIndex('idx_github_issue_imports_task').on(table.taskId),
  ],
);

export const githubDeliveries = sqliteTable(
  'github_deliveries',
  {
    id: text('id').primaryKey(),
    event: text('event').notNull(),
    receivedAt: integer('received_at').notNull(),
    processedAt: integer('processed_at'),
    payload: text('payload'),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    nextRetryAt: integer('next_retry_at'),
    leaseExpiresAt: integer('lease_expires_at'),
    updatedAt: integer('updated_at'),
    installationId: text('installation_id'),
    repositoryId: text('repository_id'),
  },
  (table) => [
    index('idx_github_deliveries_received').on(table.receivedAt),
    index('idx_github_deliveries_retry').on(table.status, table.nextRetryAt),
  ],
);

export const githubSyncRuns = sqliteTable(
  'github_sync_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    itemCount: integer('item_count').notNull().default(0),
    error: text('error'),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    index('idx_github_sync_runs_project_started').on(
      table.projectId,
      table.startedAt,
    ),
  ],
);

export const githubRedeliveryAttempts = sqliteTable(
  'github_redelivery_attempts',
  {
    deliveryId: text('delivery_id').primaryKey(),
    guid: text('guid').notNull(),
    attemptedAt: integer('attempted_at').notNull(),
  },
  (table) => [uniqueIndex('idx_github_redelivery_guid').on(table.guid)],
);

export const githubConnectionStates = sqliteTable(
  'github_connection_states',
  {
    state: text('state').primaryKey(),
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('idx_github_connection_states_expires').on(table.expiresAt),
  ],
);

export const agentTokens = sqliteTable(
  'agent_tokens',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: text('scopes').notNull().default('task:read,task:write'),
    expiresAt: integer('expires_at'),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_agent_tokens_hash').on(table.tokenHash),
    index('idx_agent_tokens_project_created').on(
      table.projectId,
      table.createdAt,
    ),
    index('idx_agent_tokens_user').on(table.userId, table.revokedAt),
  ],
);

export const taskAgentClaims = sqliteTable(
  'task_agent_claims',
  {
    taskId: text('task_id').primaryKey(),
    projectId: text('project_id').notNull(),
    tokenId: text('token_id').notNull(),
    agentName: text('agent_name').notNull(),
    leaseExpiresAt: integer('lease_expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('idx_task_agent_claims_project').on(
      table.projectId,
      table.leaseExpiresAt,
    ),
    index('idx_task_agent_claims_token').on(
      table.tokenId,
      table.leaseExpiresAt,
    ),
  ],
);

export const taskAgentUpdates = sqliteTable(
  'task_agent_updates',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    taskId: text('task_id').notNull(),
    tokenId: text('token_id').notNull(),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    metadata: text('metadata'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_task_agent_updates_task').on(table.taskId, table.createdAt),
    index('idx_task_agent_updates_project').on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const taskEvents = sqliteTable(
  'task_events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    taskId: text('task_id').notNull(),
    source: text('source').notNull(),
    kind: text('kind').notNull(),
    actorId: text('actor_id'),
    actorName: text('actor_name').notNull(),
    actorLogin: text('actor_login'),
    actorAvatarUrl: text('actor_avatar_url'),
    summary: text('summary').notNull(),
    body: text('body'),
    metadata: text('metadata'),
    dedupeKey: text('dedupe_key'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_task_events_task_created').on(table.taskId, table.createdAt),
    index('idx_task_events_project_created').on(
      table.projectId,
      table.createdAt,
    ),
    uniqueIndex('idx_task_events_project_dedupe').on(
      table.projectId,
      table.dedupeKey,
    ),
  ],
);

export const agentIdempotencyKeys = sqliteTable(
  'agent_idempotency_keys',
  {
    tokenId: text('token_id').notNull(),
    key: text('key').notNull(),
    operation: text('operation').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_agent_idempotency_token_key').on(table.tokenId, table.key),
    index('idx_agent_idempotency_created').on(table.createdAt),
  ],
);

export const createTasksTableSql = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL DEFAULT 'legacy',
    task_number INTEGER,
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
    archived_at INTEGER,
    created_by TEXT NOT NULL,
    parent_task_id TEXT
  )
`;

export const createStatusPositionIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_tasks_project_status_position
  ON tasks(project_id, status, position)
`;

export const createOwnerIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_tasks_owner_id
  ON tasks(owner_id)
`;

export const createArchivedTasksIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_tasks_project_archived
  ON tasks(project_id, archived_at)
`;

export const createParentTasksIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_tasks_project_parent
  ON tasks(project_id, parent_task_id)
`;

export const createTaskNumberIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_number
  ON tasks(project_id, task_number)
`;

export const createTaskAttachmentsTableSql = `
  CREATE TABLE IF NOT EXISTS task_attachments (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`;

export const createTaskAttachmentIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_task_attachments_project_task
  ON task_attachments(project_id, task_id, created_at)
`;

export const createUsersTableSql = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    login TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

export const createProjectsTableSql = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT,
    owner_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

export const createProjectSlugIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug
  ON projects(slug)
`;

export const createProjectMembersTableSql = `
  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, user_id)
  )
`;

export const createProjectInvitationsTableSql = `
  CREATE TABLE IF NOT EXISTS project_invitations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    identity TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    UNIQUE (project_id, identity)
  )
`;

export const createProjectMemberIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_project_members_user
  ON project_members(user_id, project_id)
`;

export const createProjectInvitationIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_project_invitations_identity
  ON project_invitations(identity, accepted_at)
`;

export const createGitHubInstallationsTableSql = `
  CREATE TABLE IF NOT EXISTS github_installations (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    account_login TEXT NOT NULL,
    account_type TEXT NOT NULL,
    repository_selection TEXT NOT NULL,
    html_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

export const createGitHubProjectInstallationsTableSql = `
  CREATE TABLE IF NOT EXISTS github_project_installations (
    project_id TEXT PRIMARY KEY NOT NULL,
    installation_id TEXT NOT NULL,
    connected_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`;

export const createGitHubRepositoriesTableSql = `
  CREATE TABLE IF NOT EXISTS github_repositories (
    id TEXT PRIMARY KEY NOT NULL,
    installation_id TEXT NOT NULL,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL UNIQUE,
    html_url TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    private INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  )
`;

export const createGitHubProjectRepositoriesTableSql = `
  CREATE TABLE IF NOT EXISTS github_project_repositories (
    project_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, repository_id)
  )
`;

export const createGitHubTaskLinksTableSql = `
  CREATE TABLE IF NOT EXISTS github_task_links (
    task_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    item_number INTEGER NOT NULL,
    branch TEXT,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    state TEXT NOT NULL,
    ci_status TEXT,
    updated_at INTEGER NOT NULL
  )
`;

export const createGitHubEventsTableSql = `
  CREATE TABLE IF NOT EXISTS github_events (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    action TEXT NOT NULL,
    item_number INTEGER,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    url TEXT,
    actor_login TEXT NOT NULL,
    actor_avatar_url TEXT,
    created_at INTEGER NOT NULL
  )
`;

export const createGitHubAutomationSettingsTableSql = `
  CREATE TABLE IF NOT EXISTS github_automation_settings (
    project_id TEXT PRIMARY KEY NOT NULL,
    issue_task_creation INTEGER NOT NULL DEFAULT 1,
    auto_link_pull_requests INTEGER NOT NULL DEFAULT 1,
    pull_request_open_status TEXT DEFAULT 'building',
    completion_status TEXT DEFAULT 'shipped',
    show_ci_failures INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

export const createGitHubIssueImportsTableSql = `
  CREATE TABLE IF NOT EXISTS github_issue_imports (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    item_number INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (project_id, repository_id, item_number),
    UNIQUE (task_id)
  )
`;

export const createGitHubDeliveriesTableSql = `
  CREATE TABLE IF NOT EXISTS github_deliveries (
    id TEXT PRIMARY KEY NOT NULL,
    event TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    processed_at INTEGER,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at INTEGER,
    lease_expires_at INTEGER,
    updated_at INTEGER,
    installation_id TEXT,
    repository_id TEXT
  )
`;

export const createGitHubSyncRunsTableSql = `
  CREATE TABLE IF NOT EXISTS github_sync_runs (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  )
`;

export const createGitHubRedeliveryAttemptsTableSql = `
  CREATE TABLE IF NOT EXISTS github_redelivery_attempts (
    delivery_id TEXT PRIMARY KEY NOT NULL,
    guid TEXT NOT NULL UNIQUE,
    attempted_at INTEGER NOT NULL
  )
`;

export const createGitHubConnectionStatesTableSql = `
  CREATE TABLE IF NOT EXISTS github_connection_states (
    state TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`;

export const createGitHubIndexesSql = [
  'CREATE INDEX IF NOT EXISTS idx_github_installations_account ON github_installations(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_github_project_installations_installation ON github_project_installations(installation_id)',
  'CREATE INDEX IF NOT EXISTS idx_github_repositories_installation ON github_repositories(installation_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_github_repositories_full_name ON github_repositories(full_name)',
  'CREATE INDEX IF NOT EXISTS idx_github_project_repositories_repository ON github_project_repositories(repository_id, project_id)',
  'CREATE INDEX IF NOT EXISTS idx_github_task_links_project ON github_task_links(project_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_github_task_links_item ON github_task_links(repository_id, kind, item_number)',
  'CREATE INDEX IF NOT EXISTS idx_github_events_project_created ON github_events(project_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_github_automation_updated ON github_automation_settings(updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_github_deliveries_received ON github_deliveries(received_at)',
  'CREATE INDEX IF NOT EXISTS idx_github_deliveries_retry ON github_deliveries(status, next_retry_at)',
  'CREATE INDEX IF NOT EXISTS idx_github_sync_runs_project_started ON github_sync_runs(project_id, started_at)',
  'CREATE INDEX IF NOT EXISTS idx_github_connection_states_expires ON github_connection_states(expires_at)',
] as const;
