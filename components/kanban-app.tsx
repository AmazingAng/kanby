'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { zhCN } from 'date-fns/locale/zh-CN';
import {
  closestCorners,
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  DragOverlay,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpRight,
  Archive,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  Clock3,
  FileText,
  FolderKanban,
  FolderPlus,
  GripVertical,
  GitBranch,
  ImageIcon,
  LoaderCircle,
  ListChecks,
  ListTree,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  RotateCcw,
  Trash2,
  UserPlus,
  Users,
  Upload,
  X,
} from 'lucide-react';

import { appPath, appRelativePath, appResourceUrl } from '@/lib/app-path';
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TaskMarkdown } from '@/components/task-markdown';
import { cn } from '@/lib/utils';
import { mergePolledTasks, shouldCloseTaskEditor } from '@/lib/task-sync';
import {
  columnAtPoint,
  keyboardInsertAfter,
  orderedColumnTasks,
  projectTaskDrop,
  shouldInsertAfter,
} from '@/lib/task-dnd';
import { isFailingCiStatus } from '@/lib/github-ci';
import {
  parseTaskDueDate,
  serializeTaskDueDate,
  taskDueLabel,
} from '@/lib/task-due';
import {
  taskMatchesMember,
  taskOwners,
  toggleTaskOwnerIds,
} from '@/lib/task-assignees';
import {
  acceptanceProgress,
  clearStarterTaskNote,
  groupSameColumnTaskFamilies,
  subtaskProgress,
  taskHierarchyKind,
} from '@/lib/task-subtasks';

type ColumnId = 'ideas' | 'building' | 'shipped';
type TaskTag = '产品' | '设计' | '代码' | '增长';
type AuthUser = {
  id: string;
  login: string;
  name: string;
  avatarUrl: string | null;
};

type Task = {
  id: string;
  number?: number;
  title: string;
  note: string;
  tag: TaskTag;
  owner: AuthUser;
  owners?: AuthUser[];
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
  attachments?: TaskAttachment[];
  acceptanceCriteria?: TaskAcceptanceCriterion[];
  githubLink?: TaskGitHubLink;
  agentState?: {
    agentName: string;
    leaseExpiresAt: number;
    lastHeartbeatAt: number;
    latestProgress: string | null;
    latestProgressAt: number | null;
  };
};

type TaskAcceptanceCriterion = {
  id: string;
  body: string;
  completed: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
};

type TaskGitHubLink = {
  repository: string;
  kind: 'issue' | 'pull_request';
  number: number;
  url: string;
  title: string;
  state: string;
  ciStatus: string | null;
};

type GitHubActivity = {
  id: string;
  repositoryId: string;
  kind: string;
  action: string;
  itemNumber: number | null;
  taskId: string | null;
  title: string;
  summary: string;
  url: string | null;
  actorLogin: string;
  actorAvatarUrl: string | null;
  createdAt: number;
};

type GitHubAutomation = {
  issueTaskCreation: boolean;
  autoLinkPullRequests: boolean;
  pullRequestOpenStatus: ColumnId | null;
  completionStatus: ColumnId | null;
  showCiFailures: boolean;
};

type TaskAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: number;
  url: string;
};

type TaskActivityEvent = {
  id: string;
  taskId: string;
  source: 'user' | 'agent' | 'github' | 'system';
  kind: string;
  actor: {
    id: string | null;
    name: string;
    login: string | null;
    avatarUrl: string | null;
  };
  summary: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
};

function mergeTaskActivity(
  current: TaskActivityEvent[],
  incoming: TaskActivityEvent[],
) {
  const events = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) events.set(event.id, event);
  return [...events.values()].sort(
    (left, right) =>
      right.createdAt - left.createdAt || right.id.localeCompare(left.id),
  );
}

function taskActivityTime(createdAt: number) {
  const date = new Date(createdAt);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function nextDemoRevision(...revisions: number[]) {
  return Math.max(Date.now(), ...revisions.map((revision) => revision + 1));
}

function taskOpenIsSuppressed(suppressUntil: number) {
  return Date.now() < suppressUntil;
}

function demoTaskActivity(task: Task): TaskActivityEvent[] {
  const now = Date.now();
  return [
    ...(task.agentState
      ? [
          {
            id: `demo-agent-${task.id}`,
            taskId: task.id,
            source: 'agent' as const,
            kind: 'agent.progress',
            actor: {
              id: 'demo-agent',
              name: task.agentState.agentName,
              login: task.owner.login,
              avatarUrl: task.owner.avatarUrl,
            },
            summary: `${task.agentState.agentName} 汇报了进度`,
            body: task.agentState.latestProgress,
            metadata: null,
            createdAt: now,
          },
        ]
      : []),
    {
      id: `demo-created-${task.id}`,
      taskId: task.id,
      source: 'user',
      kind: 'task.created',
      actor: {
        id: task.owner.id,
        name: task.owner.name,
        login: task.owner.login,
        avatarUrl: task.owner.avatarUrl,
      },
      summary: `${task.owner.name} 创建了任务`,
      body: null,
      metadata: null,
      createdAt: now - 60_000,
    },
  ];
}

type Project = {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'member';
  memberCount: number;
  taskCount: number;
  shippedCount: number;
  updatedAt: number;
};

function projectBoardPath(project: Pick<Project, 'slug'>) {
  return appPath(`/${encodeURIComponent(project.slug)}/board`);
}

type ProjectMember = AuthUser & {
  role: 'owner' | 'member';
  pending?: boolean;
};

type TaskDraft = {
  id: string;
  title: string;
  note: string;
  tag: TaskTag;
  ownerIds: string[];
  due: string;
  status: ColumnId;
  updatedAt: number;
};

type DropIndicator = {
  status: ColumnId;
  taskId?: string;
  edge: 'before' | 'after';
};

function taskDraftFingerprint(draft: TaskDraft) {
  return JSON.stringify([
    draft.id,
    draft.title.trim(),
    draft.note.trim(),
    draft.tag,
    draft.ownerIds,
    draft.due.trim(),
    draft.status,
  ]);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPreviewableImage(attachment: TaskAttachment) {
  return [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
  ].includes(attachment.contentType.toLowerCase());
}

const demoUsers: Record<'lin' | 'mika' | 'you', AuthUser> = {
  lin: { id: 'seed-lin', login: 'lin', name: 'Lin', avatarUrl: null },
  mika: { id: 'seed-mika', login: 'mika', name: 'Mika', avatarUrl: null },
  you: { id: 'seed-you', login: 'you', name: 'You', avatarUrl: null },
};

const columns: { id: ColumnId; title: string; hint: string }[] = [
  { id: 'ideas', title: '待开始', hint: '下一步做什么' },
  { id: 'building', title: '进行中', hint: '专注正在推进的工作' },
  { id: 'shipped', title: '已完成', hint: '每一次交付都算数' },
];

const taskTags: TaskTag[] = ['产品', '设计', '代码', '增长'];

const initialTasks: Task[] = [
  {
    id: 'task-1',
    title: '梳理新用户 onboarding',
    note: '把首次价值体验压缩到 60 秒内',
    tag: '产品',
    owner: demoUsers.lin,
    owners: [demoUsers.lin, demoUsers.mika],
    due: '今天',
    status: 'building',
    position: 0,
    updatedAt: 1,
    acceptanceCriteria: [
      {
        id: 'acceptance-1',
        body: '首次登录后 60 秒内创建项目',
        completed: true,
        position: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'acceptance-2',
        body: '空状态只保留一个主要操作',
        completed: false,
        position: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    agentState: {
      agentName: 'Lin / Codex',
      leaseExpiresAt: 4_102_444_800_000,
      lastHeartbeatAt: 1,
      latestProgress: '正在收敛首次登录后的项目创建流程',
      latestProgressAt: 1,
    },
  },
  {
    id: 'task-2',
    title: '实现 Command 菜单',
    note: '⌘K 快速创建与跳转',
    tag: '代码',
    owner: demoUsers.you,
    due: '周五',
    status: 'building',
    position: 1,
    updatedAt: 2,
    acceptanceCriteria: [
      {
        id: 'acceptance-3',
        body: '支持键盘打开和关闭',
        completed: false,
        position: 0,
        createdAt: 2,
        updatedAt: 2,
      },
    ],
  },
  {
    id: 'task-3',
    title: '撰写 onboarding 欢迎文案',
    note: '说人话，把下一步讲清楚',
    tag: '增长',
    owner: demoUsers.lin,
    status: 'ideas',
    position: 0,
    updatedAt: 3,
    parent: {
      id: 'task-1',
      title: '梳理新用户 onboarding',
      archived: false,
    },
  },
  {
    id: 'task-4',
    title: '设计 onboarding 空状态',
    note: '只保留一个让人行动的提示',
    tag: '设计',
    owner: demoUsers.lin,
    due: '下周一',
    status: 'ideas',
    position: 1,
    updatedAt: 4,
    parent: {
      id: 'task-1',
      title: '梳理新用户 onboarding',
      archived: false,
    },
  },
  {
    id: 'task-5',
    title: '接入错误监控',
    note: '生产环境异常自动聚合',
    tag: '代码',
    owner: demoUsers.you,
    status: 'ideas',
    position: 2,
    updatedAt: 5,
  },
  {
    id: 'task-6',
    title: '邀请 5 位种子用户',
    note: '记录首次使用的卡点',
    tag: '增长',
    owner: demoUsers.mika,
    status: 'shipped',
    position: 0,
    updatedAt: 6,
  },
  {
    id: 'task-7',
    title: '上线 onboarding v0.1',
    note: '核心流程可以稳定跑通',
    tag: '产品',
    owner: demoUsers.lin,
    status: 'shipped',
    position: 1,
    updatedAt: 7,
    parent: {
      id: 'task-1',
      title: '梳理新用户 onboarding',
      archived: false,
    },
  },
];

const dropAnimation: DropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
};

const boardCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCorners(args);

  const columnContainers = args.droppableContainers.filter(
    (container) => container.data.current?.type === 'column',
  );
  const columnId = columnAtPoint(
    columnContainers.flatMap((container) => {
      const rect = args.droppableRects.get(container.id);
      return rect ? [{ id: String(container.id) as ColumnId, rect }] : [];
    }),
    args.pointerCoordinates,
  );
  if (!columnId) return closestCorners(args);

  const taskContainers = args.droppableContainers.filter(
    (container) =>
      container.id !== args.active.id &&
      container.data.current?.type === 'task' &&
      container.data.current?.status === columnId,
  );
  if (taskContainers.length > 0) {
    const pointerTasks = taskContainers.filter((container) => {
      const rect = args.droppableRects.get(container.id);
      return Boolean(
        rect &&
        args.pointerCoordinates &&
        args.pointerCoordinates.x >= rect.left &&
        args.pointerCoordinates.x <= rect.right &&
        args.pointerCoordinates.y >= rect.top &&
        args.pointerCoordinates.y <= rect.bottom,
      );
    });
    const taskCollisions = closestCenter({
      ...args,
      droppableContainers:
        pointerTasks.length > 0 ? pointerTasks : taskContainers,
    });
    if (taskCollisions.length > 0) return taskCollisions;
  }

  const column = columnContainers.find(
    (container) => String(container.id) === columnId,
  );
  return column
    ? [{ id: column.id, data: { droppableContainer: column, value: 0 } }]
    : [];
};

function Owner({ user, label = false }: { user: AuthUser; label?: boolean }) {
  const colors: Record<string, string> = {
    'seed-lin': 'bg-[#f3b59f] text-[#542b1e]',
    'seed-mika': 'bg-[#b8d7ff] text-[#15345c]',
    'seed-you': 'bg-[#d8ff63] text-[#253000]',
  };
  return (
    <div className="flex items-center gap-2">
      <Avatar size="sm" aria-label={user.name}>
        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
        <AvatarFallback
          className={cn(
            'font-semibold',
            colors[user.id] ?? 'bg-acid text-[#253000]',
          )}
        >
          {user.name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {label && <span className="text-xs text-ink-subtle">{user.name}</span>}
    </div>
  );
}

function TaskOwnerGroup({ task }: { task: Pick<Task, 'owner' | 'owners'> }) {
  const owners = taskOwners(task);
  const label = owners.map((owner) => owner.name).join('、');
  return (
    <AvatarGroup aria-label={`负责人：${label}`} title={label}>
      {owners.map((owner) => (
        <Avatar key={owner.id} size="sm">
          {owner.avatarUrl && <AvatarImage src={owner.avatarUrl} alt="" />}
          <AvatarFallback className="bg-acid text-[10px] font-semibold text-[#253000]">
            {owner.name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
    </AvatarGroup>
  );
}

function MemberIdentity({ user }: { user: AuthUser }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Owner user={user} />
      <span className="min-w-0 truncate text-sm font-medium">
        {user.name}
        <span className="ml-1.5 text-xs font-normal text-ink-faint">
          @{user.login}
        </span>
      </span>
    </div>
  );
}

function TaskCardBody({
  task,
  progress,
}: {
  task: Task;
  progress?: { done: number; total: number; percent: number };
}) {
  const ciFailed = isFailingCiStatus(task.githubLink?.ciStatus);
  const hierarchy = taskHierarchyKind(task, progress);
  const acceptance = acceptanceProgress(task.acceptanceCriteria);
  const cardNote = clearStarterTaskNote(task.note);
  return (
    <>
      <div className="mb-2.5 flex min-w-0 flex-wrap items-center gap-1.5 pr-7">
        <Badge
          variant="outline"
          className="border-ink/10 bg-canvas text-[10px] font-medium text-ink-subtle"
        >
          {task.tag}
        </Badge>
        {hierarchy === 'parent' && (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-acid/50 bg-acid/20 px-2 py-1 text-[10px] font-semibold text-ink">
            <ListTree aria-hidden="true" className="size-3" />
            <span>父任务</span>
          </span>
        )}
        {hierarchy === 'subtask' && (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-child-border bg-child-accent/10 px-2 py-1 text-[10px] font-semibold text-ink-subtle">
            <ListTree className="size-3" />
            <span>子任务</span>
          </span>
        )}
      </div>
      <h3 className="break-words text-[15px] font-semibold leading-5 tracking-[-0.01em]">
        {task.title}
      </h3>
      {task.parent && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-subtle">
          <span className="shrink-0 text-xs" aria-hidden="true">
            ↳
          </span>
          <span className="truncate">
            {task.parent.archived ? '父任务已归档 · ' : ''}
            {task.parent.title}
          </span>
        </p>
      )}
      {cardNote && (
        <div className="mt-1.5">
          <TaskMarkdown compact>{cardNote}</TaskMarkdown>
        </div>
      )}
      {acceptance.total > 0 && (
        <div
          className={cn(
            'mt-3 flex items-center justify-between gap-3 text-[11px] font-medium',
            acceptance.complete ? 'text-ink' : 'text-ink-subtle',
          )}
          aria-label={`验收清单 ${acceptance.done}/${acceptance.total}`}
        >
          <span className="flex items-center gap-1.5">
            {acceptance.complete ? (
              <Check className="size-3.5 text-ink" />
            ) : (
              <ListChecks className="size-3.5" />
            )}
            验收清单
          </span>
          <span>
            {acceptance.done}/{acceptance.total}
          </span>
        </div>
      )}
      {progress && progress.total > 0 && (
        <div className="mt-3 border-t border-ink/[0.06] pt-3">
          <div className="flex items-center justify-between text-[10px] font-medium text-ink-subtle">
            <span className="flex items-center gap-1.5">
              <ListTree aria-hidden="true" className="size-3" /> 子任务进度
            </span>
            <span>
              {progress.done}/{progress.total} · {progress.percent}%
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full rounded-full bg-acid transition-[width]"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}
      {task.agentState && (
        <div className="mt-3 rounded-lg bg-acid/15 px-2.5 py-2">
          <p className="flex items-center gap-1.5 truncate text-[11px] font-medium text-ink">
            <span className="size-1.5 shrink-0 rounded-full bg-acid ring-2 ring-acid/25" />
            <Bot className="size-3 shrink-0" />
            <span className="truncate">
              {task.agentState.agentName} 正在处理
            </span>
          </p>
          {task.agentState.latestProgress && (
            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-ink-subtle">
              {task.agentState.latestProgress}
            </p>
          )}
        </div>
      )}
      {ciFailed && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#c94032]/20 bg-[#c94032]/10 px-2.5 py-2 text-[#9d3026]">
          <CircleAlert className="size-3.5 shrink-0" />
          <span className="text-[11px] font-semibold">CI 失败</span>
          <span className="truncate text-[10px] opacity-75">
            任务状态未改变
          </span>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <TaskOwnerGroup task={task} />
        <div className="flex items-center gap-2">
          {task.number && (
            <span className="text-[10px] font-medium text-ink-faint">
              KANBY-{task.number}
            </span>
          )}
          {task.githubLink && (
            <span className="flex items-center gap-1 text-[11px] text-ink-faint">
              <GitBranch className="size-3" />#{task.githubLink.number}
            </span>
          )}
          {Boolean(task.attachments?.length) && (
            <span className="flex items-center gap-1 text-[11px] text-ink-faint">
              <Paperclip className="size-3" />
              {task.attachments?.length}
            </span>
          )}
          {task.due ? (
            <span className="flex items-center gap-1 text-[11px] text-ink-subtle">
              <Clock3 className="size-3" /> {task.due}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}

function SortableTaskCard({
  task,
  onOpen,
  onArchive,
  archiveDisabled,
  dropEdge,
  progress,
}: {
  task: Task;
  onOpen: (task: Task) => void;
  onArchive: (task: Task) => void;
  archiveDisabled: boolean;
  dropEdge?: 'before' | 'after';
  progress?: { done: number; total: number; percent: number };
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: task.id,
    data: { type: 'task', status: task.status },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const cover = task.attachments?.find(isPreviewableImage);
  const hierarchy = taskHierarchyKind(task, progress);

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative touch-pan-y cursor-pointer overflow-hidden rounded-xl border bg-card outline-none transition-[box-shadow,border-color,opacity]',
        'hover:border-ink/25 hover:shadow-[0_10px_30px_rgba(30,30,24,0.06)] focus-visible:ring-2 focus-visible:ring-acid',
        hierarchy === 'parent' && 'border-ink/10 border-l-[3px] border-l-acid',
        hierarchy === 'subtask' &&
          'border-ink/10 border-l-[3px] border-l-child-accent',
        isDragging && 'opacity-0',
        dropEdge === 'before' &&
          'before:absolute before:inset-x-4 before:top-0 before:z-20 before:h-1 before:rounded-full before:bg-acid',
        dropEdge === 'after' &&
          'after:absolute after:inset-x-4 after:bottom-0 after:z-20 after:h-1 after:rounded-full after:bg-acid',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        type="button"
        className="absolute inset-0 z-[1] touch-pan-y cursor-grab rounded-xl outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-acid"
        onClick={() => onOpen(task)}
        aria-label={`打开或拖动任务：${task.title}`}
      />
      <button
        type="button"
        disabled={archiveDisabled || isDragging}
        onClick={() => onArchive(task)}
        className="absolute right-1.5 top-1.5 z-30 grid size-10 place-items-center rounded-full bg-card/85 text-ink-faint backdrop-blur-sm transition-colors hover:bg-canvas hover:text-ink disabled:pointer-events-none disabled:opacity-40 sm:right-1 sm:top-1 sm:size-8 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100"
        aria-label={`归档 ${task.title}`}
      >
        <Archive className="size-4" />
      </button>
      <div className={cn(cover && 'grid grid-cols-[minmax(0,1fr)_42%]')}>
        <div className={cn('p-3.5 sm:p-4', cover && 'pr-3 sm:pr-3')}>
          <TaskCardBody task={task} progress={progress} />
        </div>
        {cover && (
          <Image
            src={appResourceUrl(cover.url)}
            alt=""
            width={480}
            height={480}
            unoptimized
            draggable={false}
            className="h-full min-h-40 w-full border-l border-ink/10 object-cover"
          />
        )}
      </div>
    </article>
  );
}

function TaskCardOverlay({
  task,
  progress,
}: {
  task: Task;
  progress?: { done: number; total: number; percent: number };
}) {
  const cover = task.attachments?.find(isPreviewableImage);
  const hierarchy = taskHierarchyKind(task, progress);
  return (
    <article
      className={cn(
        'group relative cursor-grabbing overflow-hidden rounded-xl border border-ink/20 bg-card shadow-[0_20px_50px_rgba(20,20,15,0.16)] ring-1 ring-ink/5',
        hierarchy === 'parent' && 'border-ink/10 border-l-[3px] border-l-acid',
        hierarchy === 'subtask' &&
          'border-ink/10 border-l-[3px] border-l-child-accent',
      )}
    >
      <GripVertical className="absolute right-4 top-4 z-10 size-4 text-ink-faint" />
      <div className={cn(cover && 'grid grid-cols-[minmax(0,1fr)_42%]')}>
        <div className={cn('p-3.5 sm:p-4', cover && 'pr-3 sm:pr-3')}>
          <TaskCardBody task={task} progress={progress} />
        </div>
        {cover && (
          <Image
            src={appResourceUrl(cover.url)}
            alt=""
            width={480}
            height={480}
            unoptimized
            draggable={false}
            className="h-full min-h-40 w-full border-l border-ink/10 object-cover"
          />
        )}
      </div>
    </article>
  );
}

function BoardColumn({
  column,
  tasks,
  onAdd,
  onOpenTask,
  onArchiveTask,
  archiveDisabled,
  indicator,
  progressByParent,
  filtered,
}: {
  column: (typeof columns)[number];
  tasks: Task[];
  onAdd: (status: ColumnId) => void;
  onOpenTask: (task: Task) => void;
  onArchiveTask: (task: Task) => void;
  archiveDisabled: boolean;
  indicator?: DropIndicator;
  filtered: boolean;
  progressByParent: Map<
    string,
    { done: number; total: number; percent: number }
  >;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', status: column.id },
  });
  return (
    <section
      id={`column-${column.id}`}
      ref={setNodeRef}
      className={cn(
        'flex min-h-[360px] w-[calc(100vw-2.5rem)] min-w-[calc(100vw-2.5rem)] max-w-[calc(100vw-2.5rem)] flex-none snap-start scroll-mt-20 flex-col rounded-2xl border border-ink/[0.05] bg-canvas/60 p-2.5 transition-colors sm:min-h-[480px] sm:w-auto sm:min-w-[288px] sm:max-w-none sm:flex-1',
        isOver && 'border-acid/70 bg-acid-wash',
      )}
      aria-labelledby={`${column.id}-title`}
    >
      <div className="mb-4 flex items-start justify-between px-1 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'grid size-4 place-items-center rounded-full',
                column.id === 'ideas'
                  ? 'border-2 border-ink/25'
                  : column.id === 'building'
                    ? 'border-[3px] border-ink bg-acid'
                    : 'bg-ink text-background',
              )}
            >
              {column.id === 'shipped' && (
                <Check className="size-2.5" strokeWidth={3} />
              )}
            </span>
            <h2 id={`${column.id}-title`} className="text-sm font-semibold">
              {column.title}
            </h2>
            <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-semibold text-ink-subtle">
              {tasks.length}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-subtle">
            {column.id === 'building' && tasks.length > 3
              ? '进行中的任务较多，试着先完成一项'
              : column.hint}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-ink-subtle"
          onClick={() => onAdd(column.id)}
          aria-label={`添加到${column.title}`}
        >
          <Plus />
        </Button>
      </div>
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2.5">
          {tasks.map((task, index) => (
            <div
              key={task.id}
              className={cn(
                task.parent &&
                  'relative ml-4 before:absolute before:-left-2.5 before:inset-y-2 before:w-px before:bg-child-accent/45 sm:ml-5',
              )}
            >
              <SortableTaskCard
                task={task}
                onOpen={onOpenTask}
                onArchive={onArchiveTask}
                archiveDisabled={archiveDisabled}
                progress={progressByParent.get(task.id)}
                dropEdge={
                  indicator?.taskId === task.id
                    ? indicator.edge
                    : indicator &&
                        !indicator.taskId &&
                        index === tasks.length - 1
                      ? 'after'
                      : undefined
                }
              />
            </div>
          ))}
          {tasks.length === 0 && filtered ? (
            <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-ink/10 px-4 text-center text-xs text-ink-subtle">
              这一列没有匹配的任务
            </div>
          ) : (
            tasks.length === 0 && (
              <button
                onClick={() => onAdd(column.id)}
                className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-ink/15 text-xs text-ink-faint transition-colors hover:border-ink/30 hover:text-ink-subtle"
              >
                <Plus className="mr-1.5 size-3.5" /> 添加第一项
              </button>
            )
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function LoginScreen({ returnTo = '/' }: { returnTo?: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground sm:p-5">
      <section className="w-full max-w-md rounded-[24px] border border-ink/10 bg-card p-6 shadow-[0_30px_100px_rgba(20,20,15,0.08)] sm:rounded-[28px] sm:p-9">
        <div className="mb-8 flex items-center gap-3 sm:mb-10">
          <div className="grid size-9 place-items-center rounded-[11px] bg-ink text-background">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="text-base font-bold tracking-tight">kanby</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              Build less. Ship more.
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="mb-4 border-ink/10 bg-canvas text-ink-subtle"
        >
          团队工作台
        </Badge>
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-[-0.05em] sm:text-4xl">
          欢迎回来，
          <br />
          继续把它做出来。
        </h1>
        <p className="mt-4 text-sm leading-6 text-ink-subtle">
          使用 GitHub 登录。Kanby 只读取你的公开身份，不会访问代码仓库。
        </p>
        <a
          href={appPath(
            `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`,
          )}
          className={cn(
            buttonVariants(),
            'mt-8 h-12 w-full rounded-full bg-ink text-background hover:bg-ink/85',
          )}
        >
          <GitBranch className="size-4" /> 使用 GitHub 继续
        </a>
        <Link
          href="/demo"
          className="mt-4 block text-center text-xs font-medium text-ink-subtle hover:text-ink"
        >
          先看看 Demo <ArrowUpRight className="ml-1 inline size-3" />
        </Link>
        <p className="mt-5 text-center text-[11px] text-ink-faint">
          登录后，团队任务将安全保存在 Cloudflare D1。
        </p>
      </section>
    </main>
  );
}

export function KanbanApp({
  mode,
  initialProjectSlug,
}: {
  mode: 'app' | 'demo';
  initialProjectSlug?: string;
}) {
  const isDemo = mode === 'demo';
  const [tasks, setTasks] = useState<Task[]>(isDemo ? initialTasks : []);
  const [auth, setAuth] = useState<{
    configured: boolean;
    user: AuthUser | null;
  } | null>(isDemo ? { configured: false, user: null } : null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [memberManagerOpen, setMemberManagerOpen] = useState(false);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [newMemberIdentity, setNewMemberIdentity] = useState('');
  const [syncError, setSyncError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mobileColumn, setMobileColumn] = useState<ColumnId>('ideas');
  const [memberFilter, setMemberFilter] = useState('all');
  const [composer, setComposer] = useState<ColumnId | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [noteEditing, setNoteEditing] = useState(false);
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [taskLifecycleSaving, setTaskLifecycleSaving] = useState(false);
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState('');
  const [githubLinkUrl, setGithubLinkUrl] = useState('');
  const [githubLinkSaving, setGithubLinkSaving] = useState(false);
  const [githubActivity, setGithubActivity] = useState<GitHubActivity[]>([]);
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubAutomation, setGithubAutomation] =
    useState<GitHubAutomation | null>(null);
  const [githubIssueImporting, setGithubIssueImporting] = useState('');
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [taskActivity, setTaskActivity] = useState<TaskActivityEvent[]>([]);
  const [taskActivityCursor, setTaskActivityCursor] = useState<string | null>(
    null,
  );
  const [taskActivityLoading, setTaskActivityLoading] = useState(false);
  const [taskComment, setTaskComment] = useState('');
  const [taskCommentSaving, setTaskCommentSaving] = useState(false);
  const [splitTitles, setSplitTitles] = useState('');
  const [taskSplitting, setTaskSplitting] = useState(false);
  const [subtaskStatusSaving, setSubtaskStatusSaving] = useState('');
  const [acceptanceDraft, setAcceptanceDraft] = useState('');
  const [acceptanceSaving, setAcceptanceSaving] = useState('');
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(
    null,
  );
  const dragStartTasks = useRef<Task[] | null>(null);
  const dragProjectedTasks = useRef<Task[] | null>(null);
  const dragging = useRef(false);
  const suppressTaskOpenUntil = useRef(0);
  const mutationInFlight = useRef(false);
  const taskSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedTaskSaves = useRef(new Map<string, Promise<boolean>>());
  const lastSavedTask = useRef('');
  const latestTaskRevision = useRef(new Map<string, number>());
  const taskDraftRef = useRef<TaskDraft | null>(null);
  const taskEditSessionId = useRef('');
  const pendingTaskSaves = useRef(0);
  const attachmentMutation = useRef(false);
  const attachmentInput = useRef<HTMLInputElement | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const activeTask = tasks.find((task) => task.id === activeId);
  const editedTask = taskDraft
    ? (tasks.find((task) => task.id === taskDraft.id) ?? null)
    : null;
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null;
  const teamMembers = useMemo(() => {
    const unique = new Map<string, AuthUser>();
    if (isDemo) {
      for (const task of tasks) {
        for (const owner of taskOwners(task)) unique.set(owner.id, owner);
      }
    } else {
      for (const member of members) {
        if (!member.pending) unique.set(member.id, member);
      }
    }
    if (auth?.user && !unique.has(auth.user.id))
      unique.set(auth.user.id, auth.user);
    return [...unique.values()].slice(0, 3);
  }, [tasks, members, auth, isDemo]);
  const assignableMembers = useMemo(() => {
    if (isDemo) return Object.values(demoUsers);
    const activeMembers = members.filter((member) => !member.pending);
    if (taskDraft) {
      const currentOwners = taskOwners(
        tasks.find((task) => task.id === taskDraft.id) ?? {
          owner: auth?.user ?? demoUsers.you,
        },
      );
      for (const currentOwner of currentOwners) {
        if (!activeMembers.some((member) => member.id === currentOwner.id)) {
          activeMembers.push({ ...currentOwner, role: 'member' as const });
        }
      }
    }
    return activeMembers;
  }, [isDemo, members, taskDraft, tasks, auth?.user]);
  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter(
      (task) =>
        (memberFilter === 'all' || taskMatchesMember(task, memberFilter)) &&
        (!query ||
          `${task.title} ${task.note} ${task.tag} ${task.parent?.title ?? ''}`
            .toLowerCase()
            .includes(query)),
    );
  }, [tasks, memberFilter, search]);
  const progressByParent = useMemo(() => {
    const progress = new Map<
      string,
      { done: number; total: number; percent: number }
    >();
    for (const task of tasks) {
      if (task.parent) continue;
      const value = subtaskProgress(tasks, task.id);
      if (value.total > 0) progress.set(task.id, value);
    }
    return progress;
  }, [tasks]);
  const editedSubtasks = useMemo(
    () =>
      taskDraft ? tasks.filter((task) => task.parent?.id === taskDraft.id) : [],
    [taskDraft, tasks],
  );
  const editedParent = useMemo(
    () =>
      editedTask?.parent
        ? (tasks.find((task) => task.id === editedTask.parent?.id) ?? null)
        : null,
    [editedTask, tasks],
  );
  const hasFilters = Boolean(search.trim()) || memberFilter !== 'all';
  const taskHasUnsavedChanges = taskDraft
    ? taskDraftFingerprint(taskDraft) !== lastSavedFingerprint
    : false;

  useEffect(() => {
    taskDraftRef.current = taskDraft;
  }, [taskDraft]);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    fetch(appPath('/api/auth/session'), { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('session');
        return response.json() as Promise<{
          configured: boolean;
          user: AuthUser | null;
        }>;
      })
      .then(async (session) => {
        if (cancelled) return;
        setAuth(session);
        if (!session.user) return;
        const response = await fetch(appPath('/api/projects'), {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('projects');
        const payload = (await response.json()) as { projects: Project[] };
        if (!cancelled) {
          setProjects(payload.projects);
          const requestedProject = initialProjectSlug
            ? payload.projects.find(
                (project) => project.slug === initialProjectSlug,
              )
            : null;
          const selectedProject =
            requestedProject ??
            (!initialProjectSlug ? payload.projects[0] : undefined);
          setActiveProjectId(selectedProject?.id ?? null);
          if (initialProjectSlug && !requestedProject) {
            setSyncError('找不到这个项目，或你还不是项目成员。');
          } else if (
            !initialProjectSlug &&
            selectedProject &&
            appRelativePath(window.location.pathname) === '/'
          ) {
            window.history.replaceState(
              null,
              '',
              projectBoardPath(selectedProject),
            );
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuth({ configured: true, user: null });
          setSyncError('暂时无法连接工作区，请刷新后重试。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialProjectSlug, isDemo]);

  useEffect(() => {
    if (isDemo || projects.length === 0) return;
    const selectFromLocation = () => {
      const slug = decodeURIComponent(
        appRelativePath(window.location.pathname)
          .split('/')
          .filter(Boolean)[0] ?? '',
      );
      const project = projects.find((candidate) => candidate.slug === slug);
      if (project) {
        setActiveProjectId(project.id);
        setMemberFilter('all');
      }
    };
    window.addEventListener('popstate', selectFromLocation);
    return () => window.removeEventListener('popstate', selectFromLocation);
  }, [isDemo, projects]);

  useEffect(() => {
    if (isDemo || !auth?.user || !activeProjectId) return;
    const projectId = activeProjectId;
    let cancelled = false;
    let inFlight = false;
    let loadedOnce = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTasks([]);
      setMembers([]);
      setGithubActivity([]);
      setGithubConnected(false);
      setGithubAutomation(null);
    });

    async function refreshWorkspace() {
      if (inFlight) return;
      inFlight = true;
      try {
        const [taskResponse, memberResponse, githubResponse] =
          await Promise.all([
            fetch(
              appPath(`/api/tasks?projectId=${encodeURIComponent(projectId)}`),
              {
                cache: 'no-store',
              },
            ),
            fetch(
              appPath(
                `/api/members?projectId=${encodeURIComponent(projectId)}`,
              ),
              {
                cache: 'no-store',
              },
            ),
            fetch(
              appPath(`/api/github?projectId=${encodeURIComponent(projectId)}`),
              {
                cache: 'no-store',
              },
            ),
          ]);
        if (!taskResponse.ok || !memberResponse.ok || !githubResponse.ok)
          throw new Error('workspace');
        const [taskPayload, memberPayload, githubPayload] = await Promise.all([
          taskResponse.json() as Promise<{ tasks: Task[] }>,
          memberResponse.json() as Promise<{ members: ProjectMember[] }>,
          githubResponse.json() as Promise<{
            connection: {
              events: GitHubActivity[];
              automation: GitHubAutomation;
            } | null;
          }>,
        ]);
        if (cancelled) return;
        if (
          !dragging.current &&
          !mutationInFlight.current &&
          !attachmentMutation.current
        ) {
          const editingTaskId = taskDraftRef.current?.id ?? null;
          setTasks((current) =>
            mergePolledTasks(current, taskPayload.tasks, editingTaskId),
          );
          for (const task of taskPayload.tasks) {
            if (task.id !== editingTaskId)
              latestTaskRevision.current.set(task.id, task.updatedAt);
          }
        }
        if (!mutationInFlight.current) {
          setMembers(memberPayload.members);
          const memberCount = memberPayload.members.filter(
            (member) => !member.pending,
          ).length;
          setProjects((current) =>
            current.map((project) =>
              project.id === projectId ? { ...project, memberCount } : project,
            ),
          );
        }
        setGithubConnected(Boolean(githubPayload.connection));
        setGithubActivity(githubPayload.connection?.events ?? []);
        setGithubAutomation(githubPayload.connection?.automation ?? null);
        loadedOnce = true;
      } catch {
        if (!cancelled && !loadedOnce)
          setSyncError('项目数据加载失败，请刷新后重试。');
      } finally {
        inFlight = false;
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshWorkspace();
    };
    void refreshWorkspace();
    const interval = window.setInterval(refreshWhenVisible, 3000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeProjectId, auth?.user, isDemo]);

  const openTaskId = taskDraft?.id ?? null;

  useEffect(() => {
    if (!openTaskId) {
      queueMicrotask(() => {
        setTaskActivity([]);
        setTaskActivityCursor(null);
        setTaskComment('');
      });
      return;
    }
    if (isDemo) return;
    if (!activeProjectId) return;
    const projectId = activeProjectId;
    const taskId = openTaskId;
    let cancelled = false;
    let inFlight = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTaskActivity([]);
      setTaskActivityCursor(null);
      setTaskComment('');
    });

    async function refreshActivity(initial = false) {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const response = await fetch(
          appPath(
            `/api/task-events?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
          ),
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error('activity');
        const payload = (await response.json()) as {
          events: TaskActivityEvent[];
          nextCursor: string | null;
        };
        if (cancelled) return;
        setTaskActivity((current) =>
          mergeTaskActivity(current, payload.events),
        );
        if (initial) setTaskActivityCursor(payload.nextCursor);
      } catch {
        if (!cancelled && initial)
          setSyncError('任务活动加载失败，请稍后重试。');
      } finally {
        inFlight = false;
      }
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setTaskActivityLoading(true);
      void refreshActivity(true).finally(() => {
        if (!cancelled) setTaskActivityLoading(false);
      });
    });
    const interval = window.setInterval(() => void refreshActivity(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeProjectId, isDemo, openTaskId]);

  function handleDragStart(event: DragStartEvent) {
    dragging.current = true;
    suppressTaskOpenUntil.current = Number.POSITIVE_INFINITY;
    dragStartTasks.current = tasks;
    dragProjectedTasks.current = tasks;
    setDropIndicator(null);
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    const current = dragProjectedTasks.current;
    if (!current || !over) return;

    const overId = String(over.id);
    if (overId === String(active.id)) return;

    const activeTask = current.find((task) => task.id === active.id);
    const overTask = current.find((task) => task.id === overId);
    const targetStatus = columns.some((column) => column.id === overId)
      ? (overId as ColumnId)
      : overTask?.status;
    if (!activeTask || !targetStatus) return;
    const insertAfter = shouldInsertAfter(
      active.rect.current.translated,
      over.rect,
    );
    setDropIndicator({
      status: targetStatus,
      taskId: overTask?.id,
      edge: insertAfter ? 'after' : 'before',
    });
    if (event.activatorEvent.type === 'keydown') return;
    if (activeTask.status === targetStatus && overTask) return;

    const next = projectTaskDrop(
      current,
      String(active.id),
      overId,
      insertAfter,
    );
    dragProjectedTasks.current = next;
    setTasks(next);
  }

  function handleDragCancel(_event: DragCancelEvent) {
    dragging.current = false;
    suppressTaskOpenUntil.current = Date.now() + 200;
    if (dragStartTasks.current) setTasks(dragStartTasks.current);
    dragStartTasks.current = null;
    dragProjectedTasks.current = null;
    setDropIndicator(null);
    setActiveId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const snapshot = dragStartTasks.current ?? tasks;
    const projected = dragProjectedTasks.current ?? snapshot;
    dragStartTasks.current = null;
    dragProjectedTasks.current = null;
    dragging.current = false;
    suppressTaskOpenUntil.current = Date.now() + 200;
    setDropIndicator(null);
    setActiveId(null);
    if (!over) {
      setTasks(snapshot);
      return;
    }

    const overId = String(over.id);
    const insertAfter =
      (event.activatorEvent.type === 'keydown'
        ? keyboardInsertAfter(projected, String(active.id), overId)
        : null) ?? shouldInsertAfter(active.rect.current.translated, over.rect);
    const nextTasks = projectTaskDrop(
      projected,
      String(active.id),
      overId,
      insertAfter,
    );
    setTasks(nextTasks);
    if (!isDemo && auth?.user && activeProjectId) {
      mutationInFlight.current = true;
      void fetch(appPath('/api/tasks'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          movedTaskId: String(active.id),
          items: nextTasks.map(({ id, status, position }) => ({
            id,
            status,
            position,
          })),
        }),
      })
        .then((response) => {
          if (!response.ok) setSyncError('排序保存失败，请刷新后重试。');
        })
        .finally(() => {
          mutationInFlight.current = false;
        });
    }
  }
  async function addTask(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTitle.trim() || !composer) return;
    const title = newTitle.trim();
    const status = composer;
    setNewTitle('');
    setComposer(null);
    if (!isDemo && auth?.user && activeProjectId) {
      mutationInFlight.current = true;
      try {
        const response = await fetch(appPath('/api/tasks'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProjectId, title, status }),
        });
        if (!response.ok) throw new Error('create');
        const payload = (await response.json()) as { task: Task };
        setTasks((current) => [...current, payload.task]);
      } catch {
        setSyncError('任务创建失败，请重试。');
      } finally {
        mutationInFlight.current = false;
      }
      return;
    }
    const position = tasks.filter((task) => task.status === status).length;
    setTasks((current) => [
      ...current,
      {
        id: `task-${Date.now()}`,
        title,
        note: '刚刚创建，补充一点上下文吧',
        tag: '产品',
        owner: demoUsers.you,
        status,
        position,
        updatedAt: Date.now(),
      },
    ]);
  }

  function selectProject(project: Project) {
    window.history.pushState(null, '', projectBoardPath(project));
    setActiveProjectId(project.id);
    setProjectMenuOpen(false);
    setMemberFilter('all');
    setArchiveOpen(false);
    setArchivedTasks([]);
  }

  async function createNewProject(
    event: React.SyntheticEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const response = await fetch(appPath('/api/projects'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error('project');
      const payload = (await response.json()) as { project: Project };
      setProjects((current) => [payload.project, ...current]);
      selectProject(payload.project);
      setNewProjectName('');
      setProjectComposerOpen(false);
      setProjectMenuOpen(false);
    } catch {
      setSyncError('项目创建失败，请重试。');
    }
  }

  async function openMemberManager() {
    if (!activeProjectId) return;
    setProjectMenuOpen(false);
    setMemberManagerOpen(true);
    try {
      const response = await fetch(
        appPath(
          `/api/members?projectId=${encodeURIComponent(activeProjectId)}`,
        ),
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('members');
      const payload = (await response.json()) as { members: ProjectMember[] };
      setMembers(payload.members);
    } catch {
      setSyncError('成员列表加载失败，请重试。');
    }
  }

  async function inviteMember(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const identity = newMemberIdentity.trim();
    if (!identity || !activeProjectId) return;
    mutationInFlight.current = true;
    try {
      const response = await fetch(appPath('/api/members'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId, identity }),
      });
      if (!response.ok) throw new Error('invite');
      const payload = (await response.json()) as { members: ProjectMember[] };
      setMembers(payload.members);
      setProjects((current) =>
        current.map((project) =>
          project.id === activeProjectId
            ? { ...project, memberCount: payload.members.length }
            : project,
        ),
      );
      setNewMemberIdentity('');
    } catch {
      setSyncError('成员添加失败，请检查 GitHub 用户名或邮箱。');
    } finally {
      mutationInFlight.current = false;
    }
  }

  async function removeMember(memberId: string) {
    if (!activeProjectId) return;
    mutationInFlight.current = true;
    try {
      const response = await fetch(appPath('/api/members'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId, memberId }),
      });
      if (!response.ok) throw new Error('remove');
      const payload = (await response.json()) as { members: ProjectMember[] };
      setMembers(payload.members);
      setProjects((current) =>
        current.map((project) =>
          project.id === activeProjectId
            ? { ...project, memberCount: payload.members.length }
            : project,
        ),
      );
    } catch {
      setSyncError('成员移除失败，请重试。');
    } finally {
      mutationInFlight.current = false;
    }
  }

  function openTask(task: Task) {
    if (taskOpenIsSuppressed(suppressTaskOpenUntil.current)) return;
    const draft = {
      id: task.id,
      title: task.title,
      note: task.note,
      tag: task.tag,
      ownerIds: taskOwners(task).map((owner) => owner.id),
      due: task.due ?? '',
      status: task.status,
      updatedAt: task.updatedAt,
    } satisfies TaskDraft;
    lastSavedTask.current = taskDraftFingerprint(draft);
    setLastSavedFingerprint(lastSavedTask.current);
    latestTaskRevision.current.set(task.id, task.updatedAt);
    taskEditSessionId.current = crypto.randomUUID();
    setGithubLinkUrl(task.githubLink?.url ?? '');
    setSplitTitles('');
    setAcceptanceDraft('');
    setNoteEditing(false);
    setDuePickerOpen(false);
    if (isDemo) {
      setTaskActivity(demoTaskActivity(task));
      setTaskActivityCursor(null);
      setTaskComment('');
    }
    setTaskDraft(draft);
  }

  async function openRelatedTask(task: Task) {
    if (taskDraft && !(await queueTaskSave(taskDraft, true))) return;
    openTask(task);
  }

  function applyAcceptancePayload(
    taskId: string,
    payload: {
      acceptanceCriteria: TaskAcceptanceCriterion[];
      taskUpdatedAt: number;
    },
  ) {
    latestTaskRevision.current.set(taskId, payload.taskUpdatedAt);
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              acceptanceCriteria: payload.acceptanceCriteria,
              updatedAt: payload.taskUpdatedAt,
            }
          : task,
      ),
    );
    setTaskDraft((current) =>
      current?.id === taskId
        ? { ...current, updatedAt: payload.taskUpdatedAt }
        : current,
    );
  }

  async function addAcceptanceCriterion() {
    const body = acceptanceDraft.trim();
    if (!taskDraft || !body || acceptanceSaving) return;
    if (body.length > 240) {
      setSyncError('单条验收条件不能超过 240 个字符。');
      return;
    }
    if ((editedTask?.acceptanceCriteria?.length ?? 0) >= 20) {
      setSyncError('每个任务最多添加 20 条验收条件。');
      return;
    }
    setAcceptanceSaving('new');
    mutationInFlight.current = true;
    try {
      if (!(await queueTaskSave(taskDraft, true))) return;
      const taskUpdatedAt =
        latestTaskRevision.current.get(taskDraft.id) ?? taskDraft.updatedAt;
      if (isDemo) {
        const now = nextDemoRevision(taskUpdatedAt);
        const item: TaskAcceptanceCriterion = {
          id: `acceptance-${crypto.randomUUID()}`,
          body,
          completed: false,
          position: editedTask?.acceptanceCriteria?.length ?? 0,
          createdAt: now,
          updatedAt: now,
        };
        applyAcceptancePayload(taskDraft.id, {
          acceptanceCriteria: [...(editedTask?.acceptanceCriteria ?? []), item],
          taskUpdatedAt: now,
        });
      } else {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/task-checklist'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            taskId: taskDraft.id,
            body,
            taskUpdatedAt,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'create');
        applyAcceptancePayload(
          taskDraft.id,
          (await response.json()) as {
            acceptanceCriteria: TaskAcceptanceCriterion[];
            taskUpdatedAt: number;
          },
        );
      }
      setAcceptanceDraft('');
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '任务刚被其他成员修改，请等待同步后再试。'
          : '验收条件添加失败，请重试。',
      );
    } finally {
      setAcceptanceSaving('');
      mutationInFlight.current = false;
    }
  }

  async function updateAcceptanceItem(
    item: TaskAcceptanceCriterion,
    changes: { body?: string; completed?: boolean },
  ) {
    if (!taskDraft || acceptanceSaving) return;
    const body = changes.body?.trim();
    if (changes.body !== undefined && (!body || body.length > 240)) {
      setSyncError('验收条件需要 1–240 个字符。');
      return;
    }
    if (
      body === item.body &&
      (changes.completed === undefined || changes.completed === item.completed)
    )
      return;
    setAcceptanceSaving(item.id);
    mutationInFlight.current = true;
    try {
      if (!(await queueTaskSave(taskDraft, true))) return;
      const taskUpdatedAt =
        latestTaskRevision.current.get(taskDraft.id) ?? taskDraft.updatedAt;
      if (isDemo) {
        const now = nextDemoRevision(taskUpdatedAt, item.updatedAt);
        applyAcceptancePayload(taskDraft.id, {
          acceptanceCriteria: (editedTask?.acceptanceCriteria ?? []).map(
            (criterion) =>
              criterion.id === item.id
                ? {
                    ...criterion,
                    ...changes,
                    body: body ?? criterion.body,
                    updatedAt: now,
                  }
                : criterion,
          ),
          taskUpdatedAt: now,
        });
      } else {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/task-checklist'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            taskId: taskDraft.id,
            id: item.id,
            ...(body !== undefined ? { body } : {}),
            ...(changes.completed !== undefined
              ? { completed: changes.completed }
              : {}),
            updatedAt: item.updatedAt,
            taskUpdatedAt,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'update');
        applyAcceptancePayload(
          taskDraft.id,
          (await response.json()) as {
            acceptanceCriteria: TaskAcceptanceCriterion[];
            taskUpdatedAt: number;
          },
        );
      }
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '这条验收条件刚被其他成员修改，请等待同步后再试。'
          : '验收条件保存失败，请重试。',
      );
    } finally {
      setAcceptanceSaving('');
      mutationInFlight.current = false;
    }
  }

  async function removeAcceptanceItem(item: TaskAcceptanceCriterion) {
    if (!taskDraft || acceptanceSaving) return;
    setAcceptanceSaving(item.id);
    mutationInFlight.current = true;
    try {
      if (!(await queueTaskSave(taskDraft, true))) return;
      const taskUpdatedAt =
        latestTaskRevision.current.get(taskDraft.id) ?? taskDraft.updatedAt;
      if (isDemo) {
        const now = nextDemoRevision(taskUpdatedAt, item.updatedAt);
        applyAcceptancePayload(taskDraft.id, {
          acceptanceCriteria: (editedTask?.acceptanceCriteria ?? []).filter(
            (criterion) => criterion.id !== item.id,
          ),
          taskUpdatedAt: now,
        });
      } else {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/task-checklist'), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            taskId: taskDraft.id,
            id: item.id,
            updatedAt: item.updatedAt,
            taskUpdatedAt,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'delete');
        applyAcceptancePayload(
          taskDraft.id,
          (await response.json()) as {
            acceptanceCriteria: TaskAcceptanceCriterion[];
            taskUpdatedAt: number;
          },
        );
      }
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '这条验收条件刚被其他成员修改，请等待同步后再试。'
          : '验收条件删除失败，请重试。',
      );
    } finally {
      setAcceptanceSaving('');
      mutationInFlight.current = false;
    }
  }

  async function splitCurrentTask() {
    if (!taskDraft || editedTask?.parent || taskSplitting) return;
    const titles = splitTitles
      .split('\n')
      .map((title) => title.trim())
      .filter(Boolean);
    if (titles.length < 1 || titles.length > 20) {
      setSyncError('请填写 1–20 个子任务，每行一个。');
      return;
    }
    if (titles.some((title) => title.length > 160)) {
      setSyncError('子任务标题不能超过 160 个字符。');
      return;
    }
    setTaskSplitting(true);
    mutationInFlight.current = true;
    try {
      if (!(await queueTaskSave(taskDraft, true))) return;
      const parentUpdatedAt =
        latestTaskRevision.current.get(taskDraft.id) ?? taskDraft.updatedAt;
      if (isDemo) {
        const now = parentUpdatedAt + 1;
        const firstPosition = tasks.filter(
          (task) => task.status === 'ideas',
        ).length;
        const owners = taskDraft.ownerIds.flatMap((ownerId) => {
          const member = assignableMembers.find(
            (candidate) => candidate.id === ownerId,
          );
          return member ? [member] : [];
        });
        const owner = owners[0] ?? demoUsers.you;
        const created = titles.map(
          (title, index): Task => ({
            id: `task-${crypto.randomUUID()}`,
            title,
            note: '',
            tag: taskDraft.tag,
            owner,
            owners: owners.length ? owners : [owner],
            due: taskDraft.due || undefined,
            status: 'ideas',
            position: firstPosition + index,
            updatedAt: now,
            parent: {
              id: taskDraft.id,
              title: taskDraft.title,
              archived: false,
            },
          }),
        );
        setTasks((current) => [
          ...current.map((task) =>
            task.id === taskDraft.id ? { ...task, updatedAt: now } : task,
          ),
          ...created,
        ]);
        latestTaskRevision.current.set(taskDraft.id, now);
        setTaskDraft((current) =>
          current?.id === taskDraft.id
            ? { ...current, updatedAt: now }
            : current,
        );
      } else {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/tasks/split'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            parentTaskId: taskDraft.id,
            parentUpdatedAt,
            titles,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'split');
        const payload = (await response.json()) as {
          parentUpdatedAt: number;
          tasks: Task[];
        };
        latestTaskRevision.current.set(taskDraft.id, payload.parentUpdatedAt);
        for (const task of payload.tasks)
          latestTaskRevision.current.set(task.id, task.updatedAt);
        const createdIds = new Set(payload.tasks.map((task) => task.id));
        setTasks((current) => [
          ...current
            .filter((task) => !createdIds.has(task.id))
            .map((task) =>
              task.id === taskDraft.id
                ? { ...task, updatedAt: payload.parentUpdatedAt }
                : task,
            ),
          ...payload.tasks,
        ]);
        setTaskDraft((current) =>
          current?.id === taskDraft.id
            ? { ...current, updatedAt: payload.parentUpdatedAt }
            : current,
        );
      }
      setSplitTitles('');
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '任务已被其他成员修改，请等待同步后再拆分。'
          : '子任务创建失败，请重试。',
      );
    } finally {
      setTaskSplitting(false);
      mutationInFlight.current = false;
    }
  }

  async function toggleSubtaskStatus(task: Task) {
    if (subtaskStatusSaving) return;
    const status: ColumnId = task.status === 'shipped' ? 'ideas' : 'shipped';
    setSubtaskStatusSaving(task.id);
    mutationInFlight.current = true;
    try {
      if (isDemo) {
        const now = task.updatedAt + 1;
        setTasks((current) =>
          current.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  status,
                  position: current.filter(
                    (candidate) =>
                      candidate.status === status && candidate.id !== task.id,
                  ).length,
                  updatedAt: now,
                }
              : item,
          ),
        );
        latestTaskRevision.current.set(task.id, now);
      } else {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/tasks'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            id: task.id,
            title: task.title,
            note: task.note,
            tag: task.tag,
            ownerId: task.owner.id,
            ownerIds: taskOwners(task).map((owner) => owner.id),
            due: task.due ?? '',
            status,
            updatedAt:
              latestTaskRevision.current.get(task.id) ?? task.updatedAt,
            editSessionId: crypto.randomUUID(),
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'update');
        const payload = (await response.json()) as { task: Task };
        latestTaskRevision.current.set(payload.task.id, payload.task.updatedAt);
        setTasks((current) =>
          current.map((item) =>
            item.id === payload.task.id ? payload.task : item,
          ),
        );
      }
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '子任务已被其他成员修改，请等待同步后重试。'
          : '子任务状态更新失败，请重试。',
      );
    } finally {
      setSubtaskStatusSaving('');
      mutationInFlight.current = false;
    }
  }

  async function loadOlderTaskActivity() {
    if (
      isDemo ||
      !taskDraft ||
      !activeProjectId ||
      !taskActivityCursor ||
      taskActivityLoading
    )
      return;
    const cursor = taskActivityCursor;
    setTaskActivityLoading(true);
    try {
      const response = await fetch(
        appPath(
          `/api/task-events?projectId=${encodeURIComponent(activeProjectId)}&taskId=${encodeURIComponent(taskDraft.id)}&cursor=${encodeURIComponent(cursor)}`,
        ),
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('activity');
      const payload = (await response.json()) as {
        events: TaskActivityEvent[];
        nextCursor: string | null;
      };
      setTaskActivity((current) => mergeTaskActivity(current, payload.events));
      setTaskActivityCursor(payload.nextCursor);
    } catch {
      setSyncError('更早的任务活动加载失败，请重试。');
    } finally {
      setTaskActivityLoading(false);
    }
  }

  async function submitTaskComment() {
    const body = taskComment.trim();
    if (!taskDraft || !body || taskCommentSaving) return;
    if (isDemo) {
      const actor = demoUsers.you;
      setTaskActivity((current) =>
        mergeTaskActivity(current, [
          {
            id: crypto.randomUUID(),
            taskId: taskDraft.id,
            source: 'user',
            kind: 'comment.created',
            actor: {
              id: actor.id,
              name: actor.name,
              login: actor.login,
              avatarUrl: actor.avatarUrl,
            },
            summary: `${actor.name} 发表了评论`,
            body,
            metadata: null,
            createdAt: Date.now(),
          },
        ]),
      );
      setTaskComment('');
      return;
    }
    if (!activeProjectId) return;
    setTaskCommentSaving(true);
    try {
      const response = await fetch(appPath('/api/task-events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          taskId: taskDraft.id,
          body,
        }),
      });
      if (!response.ok) throw new Error('comment');
      const payload = (await response.json()) as { event: TaskActivityEvent };
      setTaskActivity((current) => mergeTaskActivity(current, [payload.event]));
      setTaskComment('');
    } catch {
      setSyncError('评论发送失败，请重试。');
    } finally {
      setTaskCommentSaving(false);
    }
  }

  async function openArchive() {
    setArchiveOpen(true);
    if (isDemo || !activeProjectId) return;
    try {
      const response = await fetch(
        appPath(
          `/api/tasks?projectId=${encodeURIComponent(activeProjectId)}&archived=1`,
        ),
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('archive');
      const payload = (await response.json()) as { tasks: Task[] };
      setArchivedTasks(payload.tasks);
    } catch {
      setSyncError('归档任务加载失败，请重试。');
    }
  }

  async function archiveCurrentTask() {
    if (!taskDraft || taskLifecycleSaving) return;
    setTaskLifecycleSaving(true);
    try {
      const saved = await queueTaskSave(taskDraft, true);
      if (!saved) return;
      let archivedTask: Task;
      if (isDemo) {
        const current = tasks.find((task) => task.id === taskDraft.id);
        if (!current) return;
        const now = current.updatedAt + 1;
        archivedTask = { ...current, archivedAt: now, updatedAt: now };
      } else {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/tasks'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            id: taskDraft.id,
            action: 'archive',
            updatedAt:
              latestTaskRevision.current.get(taskDraft.id) ??
              taskDraft.updatedAt,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'archive');
        archivedTask = ((await response.json()) as { task: Task }).task;
      }
      setTasks((current) =>
        current
          .filter((task) => task.id !== archivedTask.id)
          .map((task) =>
            task.parent?.id === archivedTask.id
              ? {
                  ...task,
                  parent: { ...task.parent, archived: true },
                }
              : task,
          ),
      );
      setArchivedTasks((current) => [
        archivedTask,
        ...current.filter((task) => task.id !== archivedTask.id),
      ]);
      setTaskDraft(null);
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '任务刚刚被其他成员修改，请重新打开后再归档。'
          : '任务归档失败，请重试。',
      );
    } finally {
      setTaskLifecycleSaving(false);
    }
  }

  async function archiveTaskFromCard(task: Task) {
    if (taskLifecycleSaving || dragging.current) return;
    setTaskLifecycleSaving(true);
    try {
      let archivedTask: Task;
      if (isDemo) {
        const now = task.updatedAt + 1;
        archivedTask = { ...task, archivedAt: now, updatedAt: now };
      } else {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/tasks'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            id: task.id,
            action: 'archive',
            updatedAt:
              latestTaskRevision.current.get(task.id) ?? task.updatedAt,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'archive');
        archivedTask = ((await response.json()) as { task: Task }).task;
      }
      setTasks((current) =>
        current
          .filter((item) => item.id !== archivedTask.id)
          .map((item) =>
            item.parent?.id === archivedTask.id
              ? {
                  ...item,
                  parent: { ...item.parent, archived: true },
                }
              : item,
          ),
      );
      setArchivedTasks((current) => [
        archivedTask,
        ...current.filter((item) => item.id !== archivedTask.id),
      ]);
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '任务刚刚被其他成员修改，请刷新后再归档。'
          : '任务归档失败，请重试。',
      );
    } finally {
      setTaskLifecycleSaving(false);
    }
  }

  async function restoreArchivedTask(task: Task) {
    if (taskLifecycleSaving) return;
    setTaskLifecycleSaving(true);
    try {
      let restored: Task;
      if (isDemo) {
        const { archivedAt: _archivedAt, ...activeTask } = task;
        restored = { ...activeTask, updatedAt: task.updatedAt + 1 };
      } else {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/tasks'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            id: task.id,
            action: 'restore',
            updatedAt: task.updatedAt,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'restore');
        restored = ((await response.json()) as { task: Task }).task;
      }
      setArchivedTasks((current) =>
        current
          .filter((item) => item.id !== task.id)
          .map((item) =>
            item.parent?.id === restored.id
              ? {
                  ...item,
                  parent: {
                    ...item.parent,
                    title: restored.title,
                    archived: false,
                  },
                }
              : item,
          ),
      );
      setTasks((current) => [
        ...current
          .filter((item) => item.id !== task.id)
          .map((item) =>
            item.parent?.id === restored.id
              ? {
                  ...item,
                  parent: {
                    ...item.parent,
                    title: restored.title,
                    archived: false,
                  },
                }
              : item,
          ),
        restored,
      ]);
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '归档任务已发生变化，请重新打开归档区。'
          : '任务恢复失败，请重试。',
      );
    } finally {
      setTaskLifecycleSaving(false);
    }
  }

  async function deleteArchivedTask(task: Task) {
    if (taskLifecycleSaving) return;
    if (!window.confirm(`永久删除“${task.title}”？此操作无法撤销。`)) return;
    setTaskLifecycleSaving(true);
    try {
      let promotedTasks: Task[] = [];
      if (!isDemo) {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/tasks'), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            id: task.id,
            updatedAt: task.updatedAt,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'delete');
        promotedTasks =
          ((await response.json()) as { promotedTasks?: Task[] })
            .promotedTasks ?? [];
      } else {
        const now =
          Math.max(
            task.updatedAt,
            ...tasks.map((item) => item.updatedAt),
            ...archivedTasks.map((item) => item.updatedAt),
          ) + 1;
        promotedTasks = [
          ...tasks.filter((item) => item.parent?.id === task.id),
          ...archivedTasks.filter((item) => item.parent?.id === task.id),
        ].map(({ parent: _parent, ...item }) => ({
          ...item,
          updatedAt: Math.max(now, item.updatedAt + 1),
        }));
      }
      const promotedById = new Map(
        promotedTasks.map((promoted) => [promoted.id, promoted]),
      );
      setArchivedTasks((current) =>
        current
          .filter((item) => item.id !== task.id)
          .map((item) => promotedById.get(item.id) ?? item),
      );
      setTasks((current) =>
        current.map((item) => promotedById.get(item.id) ?? item),
      );
      for (const promoted of promotedTasks)
        latestTaskRevision.current.set(promoted.id, promoted.updatedAt);
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'conflict'
          ? '归档任务已发生变化，请重新打开归档区。'
          : '永久删除失败，请重试。',
      );
    } finally {
      setTaskLifecycleSaving(false);
    }
  }

  async function createTaskFromGitHubIssue(activity: GitHubActivity) {
    if (
      !activeProjectId ||
      activity.kind !== 'issues' ||
      activity.itemNumber == null ||
      githubIssueImporting
    )
      return;
    setGithubIssueImporting(activity.id);
    mutationInFlight.current = true;
    try {
      const response = await fetch(appPath('/api/github/issue-task'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          eventId: activity.id,
        }),
      });
      if (!response.ok)
        throw new Error(response.status === 409 ? 'disabled' : 'import');
      const payload = (await response.json()) as { task: Task };
      latestTaskRevision.current.set(payload.task.id, payload.task.updatedAt);
      setTasks((current) => [
        ...current.filter((task) => task.id !== payload.task.id),
        payload.task,
      ]);
      setGithubActivity((current) =>
        current.map((item) =>
          item.id === activity.id ? { ...item, taskId: payload.task.id } : item,
        ),
      );
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'disabled'
          ? '这个项目已关闭 Issue 一键创建任务。'
          : '从 GitHub Issue 创建任务失败，请重试。',
      );
    } finally {
      mutationInFlight.current = false;
      setGithubIssueImporting('');
    }
  }

  async function linkGitHubItem() {
    if (!taskDraft || !activeProjectId || !githubLinkUrl.trim() || isDemo)
      return;
    setGithubLinkSaving(true);
    try {
      const response = await fetch(appPath('/api/github/task-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          taskId: taskDraft.id,
          url: githubLinkUrl.trim(),
        }),
      });
      if (!response.ok) throw new Error('link');
      const payload = (await response.json()) as {
        link: TaskGitHubLink & { taskId: string };
      };
      setTasks((current) =>
        current.map((task) =>
          task.id === taskDraft.id
            ? { ...task, githubLink: payload.link }
            : task,
        ),
      );
      setGithubLinkUrl(payload.link.url);
    } catch {
      setSyncError(
        '关联失败：请确认这是已启用仓库中的 Issue 或 Pull Request。',
      );
    } finally {
      setGithubLinkSaving(false);
    }
  }

  async function unlinkGitHubItem() {
    if (!taskDraft || !activeProjectId || isDemo) return;
    setGithubLinkSaving(true);
    try {
      const response = await fetch(appPath('/api/github/task-link'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          taskId: taskDraft.id,
        }),
      });
      if (!response.ok) throw new Error('unlink');
      setTasks((current) =>
        current.map((task) =>
          task.id === taskDraft.id ? { ...task, githubLink: undefined } : task,
        ),
      );
      setGithubLinkUrl('');
    } catch {
      setSyncError('GitHub 关联移除失败。');
    } finally {
      setGithubLinkSaving(false);
    }
  }

  function queueTaskSave(
    source: TaskDraft,
    reportInvalid = false,
  ): Promise<boolean> {
    const draft = {
      ...source,
      title: source.title.trim(),
      note: source.note.trim(),
      due: source.due.trim(),
    };
    const ownerById = new Map(
      assignableMembers.map((member) => [member.id, member]),
    );
    const owners = draft.ownerIds.flatMap((ownerId) => {
      const owner = ownerById.get(ownerId);
      return owner ? [owner] : [];
    });
    const ownerIdsAreValid =
      draft.ownerIds.length >= 1 &&
      draft.ownerIds.length <= 3 &&
      new Set(draft.ownerIds).size === draft.ownerIds.length &&
      owners.length === draft.ownerIds.length;
    const owner = owners[0];
    if (!draft.title || !owner || !ownerIdsAreValid) {
      if (reportInvalid)
        setSyncError(
          !draft.title ? '任务标题不能为空。' : '请选择 1–3 位当前项目成员。',
        );
      return Promise.resolve(false);
    }
    const fingerprint = taskDraftFingerprint(draft);
    if (fingerprint === lastSavedTask.current) return Promise.resolve(true);
    const saveKey = `${draft.id}:${fingerprint}`;
    const queued = queuedTaskSaves.current.get(saveKey);
    if (queued) return queued;

    pendingTaskSaves.current += 1;
    setTaskSaving(true);
    mutationInFlight.current = true;

    const save = taskSaveQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (isDemo) {
          setTasks((current) =>
            current.map((task) => {
              if (task.id === draft.id) {
                const { ownerIds: _ownerIds, ...taskFields } = draft;
                const position =
                  task.status === draft.status
                    ? task.position
                    : current.filter(
                        (candidate) =>
                          candidate.status === draft.status &&
                          candidate.id !== draft.id,
                      ).length;
                return {
                  ...task,
                  ...taskFields,
                  due: draft.due || undefined,
                  owner,
                  owners,
                  position,
                  updatedAt: Date.now(),
                };
              }
              return task.parent?.id === draft.id
                ? {
                    ...task,
                    parent: { ...task.parent, title: draft.title },
                  }
                : task;
            }),
          );
          return true;
        }

        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/tasks'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            ...draft,
            editSessionId: taskEditSessionId.current,
            updatedAt:
              latestTaskRevision.current.get(draft.id) ?? draft.updatedAt,
          }),
        });
        if (!response.ok)
          throw new Error(response.status === 409 ? 'conflict' : 'update');
        const payload = (await response.json()) as { task: Task };
        latestTaskRevision.current.set(payload.task.id, payload.task.updatedAt);
        setTasks((current) =>
          current.map((task) => {
            if (task.id === payload.task.id) return payload.task;
            if (task.parent?.id === payload.task.id)
              return {
                ...task,
                parent: { ...task.parent, title: payload.task.title },
              };
            return task;
          }),
        );
        setArchivedTasks((current) =>
          current.map((task) =>
            task.parent?.id === payload.task.id
              ? {
                  ...task,
                  parent: { ...task.parent, title: payload.task.title },
                }
              : task,
          ),
        );
        setTaskDraft((current) =>
          current?.id === payload.task.id
            ? { ...current, updatedAt: payload.task.updatedAt }
            : current,
        );
        return true;
      })
      .then((saved) => {
        if (saved) {
          lastSavedTask.current = fingerprint;
          setLastSavedFingerprint(fingerprint);
        }
        return saved;
      })
      .catch((error: Error) => {
        setSyncError(
          error.message === 'conflict'
            ? '任务已被其他成员或 Agent 修改；你的内容仍保留在编辑器中，请确认后重试。'
            : '任务自动保存失败；内容仍保留在编辑器中，请重试。',
        );
        return false;
      })
      .finally(() => {
        queuedTaskSaves.current.delete(saveKey);
        pendingTaskSaves.current = Math.max(0, pendingTaskSaves.current - 1);
        if (pendingTaskSaves.current === 0) {
          setTaskSaving(false);
          mutationInFlight.current = false;
        }
      });
    queuedTaskSaves.current.set(saveKey, save);
    taskSaveQueue.current = save.then(() => undefined);
    return save;
  }

  const saveTaskFromEffect = useEffectEvent((draft: TaskDraft) => {
    void queueTaskSave(draft);
  });

  useEffect(() => {
    if (!taskDraft) return;
    const timeout = window.setTimeout(() => {
      saveTaskFromEffect(taskDraft);
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [taskDraft]);

  async function closeTaskEditor() {
    if (!taskDraft) return;
    const savingDraft = taskDraft;
    const fingerprint = taskDraftFingerprint(savingDraft);
    const saved = await queueTaskSave(savingDraft, true);
    const current = taskDraftRef.current;
    if (
      shouldCloseTaskEditor({
        saveSucceeded: saved,
        savedTaskId: savingDraft.id,
        savedFingerprint: fingerprint,
        currentTaskId: current?.id ?? null,
        currentFingerprint: current ? taskDraftFingerprint(current) : null,
      })
    ) {
      setDuePickerOpen(false);
      setTaskDraft(null);
    }
  }

  function finishTaskEditing(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void closeTaskEditor();
  }

  async function uploadTaskAttachments(fileList: FileList | File[]) {
    if (!taskDraft || attachmentUploading) return;
    const existingCount = editedTask?.attachments?.length ?? 0;
    const files = Array.from(fileList).slice(
      0,
      Math.max(0, 10 - existingCount),
    );
    if (files.length === 0) {
      setSyncError('每个任务最多添加 10 个附件。');
      return;
    }
    if (files.some((file) => file.size === 0 || file.size > 10 * 1024 * 1024)) {
      setSyncError('单个附件需要小于 10 MB，且不能为空文件。');
      return;
    }

    setAttachmentUploading(true);
    attachmentMutation.current = true;
    try {
      for (const file of files) {
        let attachment: TaskAttachment;
        if (isDemo) {
          attachment = {
            id: `attachment-${crypto.randomUUID()}`,
            name: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
            createdAt: Date.now(),
            url: URL.createObjectURL(file),
          };
        } else {
          if (!activeProjectId) throw new Error('project');
          const form = new FormData();
          form.set('projectId', activeProjectId);
          form.set('taskId', taskDraft.id);
          form.set('file', file);
          const response = await fetch(appPath('/api/attachments'), {
            method: 'POST',
            body: form,
          });
          if (!response.ok)
            throw new Error(response.status === 413 ? 'too-large' : 'upload');
          const payload = (await response.json()) as {
            attachment: TaskAttachment;
          };
          attachment = payload.attachment;
        }
        setTasks((current) =>
          current.map((task) =>
            task.id === taskDraft.id
              ? {
                  ...task,
                  attachments: [...(task.attachments ?? []), attachment],
                }
              : task,
          ),
        );
      }
    } catch (error) {
      setSyncError(
        error instanceof Error && error.message === 'too-large'
          ? '单个附件不能超过 10 MB。'
          : '附件上传失败，请重试。',
      );
    } finally {
      setAttachmentUploading(false);
      setAttachmentDragActive(false);
      attachmentMutation.current = false;
      if (attachmentInput.current) attachmentInput.current.value = '';
    }
  }

  async function removeTaskAttachment(attachment: TaskAttachment) {
    if (!taskDraft || attachmentUploading) return;
    attachmentMutation.current = true;
    try {
      if (!isDemo) {
        if (!activeProjectId) throw new Error('project');
        const response = await fetch(appPath('/api/attachments'), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: activeProjectId,
            id: attachment.id,
          }),
        });
        if (!response.ok) throw new Error('delete');
      } else if (attachment.url.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.url);
      }
      setTasks((current) =>
        current.map((task) =>
          task.id === taskDraft.id
            ? {
                ...task,
                attachments: (task.attachments ?? []).filter(
                  (item) => item.id !== attachment.id,
                ),
              }
            : task,
        ),
      );
    } catch {
      setSyncError('附件删除失败，请重试。');
    } finally {
      attachmentMutation.current = false;
    }
  }

  if (!auth) {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <LoaderCircle className="size-5 animate-spin text-ink-faint" />
        <span className="sr-only">正在加载</span>
      </main>
    );
  }
  if (!isDemo && auth.configured && !auth.user) {
    const returnTo = initialProjectSlug
      ? `/${encodeURIComponent(initialProjectSlug)}/board`
      : '/';
    return <LoginScreen returnTo={returnTo} />;
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-[1480px] px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        <header className="sticky top-0 z-30 -mx-4 flex h-16 items-center justify-between border-b border-ink/10 bg-background/90 px-4 backdrop-blur-md sm:static sm:mx-0 sm:h-16 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
          <div className="flex items-center gap-3">
            <Link
              href={isDemo ? '/' : '/app'}
              className="grid size-8 place-items-center rounded-[10px] bg-ink text-background"
              aria-label="返回 Kanby"
            >
              <Sparkles className="size-4" />
            </Link>
            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="hidden text-[15px] font-bold tracking-[-0.02em] sm:inline">
                  kanby
                </span>
                <span className="hidden text-ink-faint sm:inline">/</span>
                <button
                  onClick={() => !isDemo && setProjectMenuOpen((open) => !open)}
                  className="flex max-w-24 items-center gap-1 truncate text-[12px] font-medium text-ink-subtle hover:text-ink sm:max-w-52 sm:text-[13px]"
                  aria-expanded={projectMenuOpen}
                >
                  {isDemo ? 'Demo' : (activeProject?.name ?? '项目')}{' '}
                  {!isDemo && <ChevronDown className="size-3" />}
                </button>
              </div>
              {projectMenuOpen && !isDemo && (
                <div className="absolute left-12 top-9 z-50 w-64 rounded-2xl border border-ink/10 bg-card p-2 shadow-[0_18px_60px_rgba(20,20,15,0.14)] sm:left-20">
                  <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    你的项目
                  </p>
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => selectProject(project)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm hover:bg-ink/5',
                        activeProjectId === project.id &&
                          'bg-ink/5 font-semibold',
                      )}
                    >
                      <span className="truncate">{project.name}</span>
                      <span className="text-[10px] font-normal text-ink-faint">
                        {project.memberCount} 人
                      </span>
                    </button>
                  ))}
                  <div className="my-1 h-px bg-ink/10" />
                  <button
                    onClick={() => {
                      setProjectComposerOpen(true);
                      setProjectMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-ink-subtle hover:bg-ink/5 hover:text-ink"
                  >
                    <FolderPlus className="size-4" /> 新建项目
                  </button>
                  {activeProject && (
                    <button
                      onClick={openMemberManager}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-ink-subtle hover:bg-ink/5 hover:text-ink"
                    >
                      <Users className="size-4" /> 团队成员
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {!isDemo && (
              <Link
                href={appPath('/settings')}
                className="grid size-8 place-items-center rounded-full text-ink-faint hover:bg-ink/5 hover:text-ink"
                aria-label="设置"
              >
                <Settings className="size-4" />
              </Link>
            )}
            {(activeProject || isDemo) && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full text-ink-faint hover:text-ink"
                onClick={() => void openArchive()}
                aria-label="打开任务归档"
              >
                <Archive />
              </Button>
            )}
            <Button
              className="h-10 rounded-xl bg-ink px-3 text-background hover:bg-ink/80 sm:px-4"
              onClick={() =>
                activeProject || isDemo
                  ? setComposer('ideas')
                  : setProjectComposerOpen(true)
              }
              aria-label={activeProject || isDemo ? '新任务' : '新建项目'}
            >
              {activeProject || isDemo ? <Plus /> : <FolderPlus />}
              <span>{activeProject || isDemo ? '新任务' : '新建项目'}</span>
            </Button>
          </div>
        </header>

        {!isDemo && !activeProject ? (
          <section className="grid min-h-[calc(100dvh-4rem)] place-items-center py-12 sm:min-h-[calc(100dvh-5rem)]">
            <div className="w-full max-w-lg text-center">
              <div className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl border border-ink/10 bg-card shadow-[0_12px_40px_rgba(20,20,15,0.06)]">
                <FolderKanban className="size-6 text-ink-subtle" />
              </div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                新的工作区
              </p>
              <h1 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
                从一个项目开始。
              </h1>
              <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-ink-subtle">
                创建项目，把真正要推进的任务和 1–3 位伙伴放在一起。
              </p>
              <Button
                className="mt-7 h-11 rounded-full bg-ink px-5 text-background hover:bg-ink/80"
                onClick={() => setProjectComposerOpen(true)}
              >
                <FolderPlus /> 新建项目
              </Button>
              {syncError && (
                <button
                  onClick={() => setSyncError('')}
                  className="mx-auto mt-5 flex items-center gap-2 text-xs text-[#9d3026]"
                >
                  <span>{syncError}</span>
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </section>
        ) : (
          <>
            <h1 className="sr-only">
              {isDemo ? '示例看板' : `${activeProject?.name} 看板`}
            </h1>
            <div className="flex flex-wrap items-center gap-2 py-3">
              <div className="relative min-w-0 flex-1 sm:max-w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="搜索任务"
                  placeholder="搜索任务…"
                  className="h-10 rounded-xl border-ink/10 bg-card pl-9 pr-9 text-sm shadow-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="清除搜索"
                    className="absolute right-0 top-0 grid size-10 place-items-center rounded-xl text-ink-subtle hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="relative shrink-0">
                <Users className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
                <select
                  value={memberFilter}
                  onChange={(event) => setMemberFilter(event.target.value)}
                  aria-label="按负责人筛选"
                  className="h-10 max-w-40 appearance-none rounded-xl border border-ink/10 bg-card pl-9 pr-8 text-xs font-medium text-ink"
                >
                  <option value="all">所有成员</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-ink-subtle" />
              </div>
              {githubConnected && (
                <Popover key={activeProjectId}>
                  <PopoverTrigger
                    className="ml-auto flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-medium text-ink-subtle hover:bg-ink/5 data-popup-open:bg-ink/5"
                    aria-label="GitHub 动态"
                    title="GitHub 动态"
                  >
                    <GitBranch className="size-4" />
                    <span className="hidden sm:inline">GitHub 动态</span>
                    <ChevronDown className="hidden size-3 sm:block" />
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-96 max-w-[calc(100vw-2rem)] rounded-2xl p-3"
                    aria-label="GitHub 最近动态"
                  >
                    <div className="flex items-center justify-between gap-3 px-1 pb-1">
                      <p className="text-xs font-semibold">GitHub 最近动态</p>
                      <Link
                        href={`/settings?project=${encodeURIComponent(activeProjectId ?? '')}`}
                        className="rounded-lg px-2 py-1 text-xs text-ink-subtle hover:bg-ink/5"
                      >
                        设置
                      </Link>
                    </div>
                    <div className="max-h-[min(24rem,60dvh)] space-y-2 overflow-y-auto">
                      {githubActivity.length > 0 ? (
                        githubActivity.slice(0, 4).map((activity) => (
                          <div
                            key={activity.id}
                            className="min-w-0 rounded-xl bg-canvas px-3 py-2.5"
                          >
                            {activity.url ? (
                              <a
                                href={activity.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-[11px] font-medium hover:underline"
                              >
                                {activity.title}
                              </a>
                            ) : (
                              <p className="truncate text-[11px] font-medium">
                                {activity.title}
                              </p>
                            )}
                            <p className="mt-0.5 truncate text-[11px] leading-4 text-ink-subtle">
                              {activity.summary}
                            </p>
                            {activity.kind === 'issues' &&
                              activity.itemNumber != null &&
                              githubAutomation?.issueTaskCreation && (
                                <button
                                  type="button"
                                  disabled={
                                    Boolean(activity.taskId) ||
                                    githubIssueImporting === activity.id
                                  }
                                  onClick={() =>
                                    void createTaskFromGitHubIssue(activity)
                                  }
                                  className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-ink disabled:text-ink-faint"
                                >
                                  {githubIssueImporting === activity.id ? (
                                    <LoaderCircle className="size-3 animate-spin" />
                                  ) : activity.taskId ? (
                                    <Check className="size-3" />
                                  ) : (
                                    <Plus className="size-3" />
                                  )}
                                  {activity.taskId ? '已创建任务' : '创建任务'}
                                </button>
                              )}
                          </div>
                        ))
                      ) : (
                        <p className="px-2 text-[11px] text-ink-faint">
                          等待仓库动态
                        </p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              {hasFilters && (
                <div className="flex w-full items-center gap-3 text-xs sm:ml-auto sm:w-auto">
                  <output className="text-ink-subtle">
                    显示 {visibleTasks.length} / {tasks.length} 项任务
                  </output>
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setMemberFilter('all');
                    }}
                    className="rounded-lg px-2 py-2 font-medium text-ink hover:bg-ink/5"
                  >
                    重置筛选
                  </button>
                </div>
              )}
            </div>
            {syncError && (
              <button
                onClick={() => setSyncError('')}
                className="mb-4 flex w-full items-center justify-between rounded-2xl border border-[#c94032]/20 bg-[#c94032]/5 px-4 py-3 text-left text-xs text-[#9d3026]"
              >
                <span>{syncError}</span>
                <X className="size-3.5" />
              </button>
            )}
            <nav
              className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-ink/[0.05] p-1 sm:hidden"
              aria-label="看板列快捷导航"
            >
              {columns.map((column) => (
                <button
                  key={column.id}
                  onClick={() => {
                    setMobileColumn(column.id);
                    document
                      .getElementById(`column-${column.id}`)
                      ?.scrollIntoView({
                        behavior: window.matchMedia(
                          '(prefers-reduced-motion: reduce)',
                        ).matches
                          ? 'auto'
                          : 'smooth',
                        block: 'nearest',
                        inline: 'start',
                      });
                  }}
                  className={cn(
                    'flex min-h-10 items-center justify-center gap-2 rounded-lg text-xs font-medium transition-colors',
                    mobileColumn === column.id
                      ? 'bg-card text-ink shadow-sm'
                      : 'text-ink-subtle hover:text-ink',
                  )}
                  aria-current={mobileColumn === column.id ? 'true' : undefined}
                  aria-controls={`column-${column.id}`}
                >
                  {column.title}
                  <span className="text-ink-faint">
                    {
                      visibleTasks.filter((task) => task.status === column.id)
                        .length
                    }
                  </span>
                </button>
              ))}
            </nav>
            <DndContext
              id="kanby-board"
              sensors={sensors}
              collisionDetection={boardCollisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragCancel={handleDragCancel}
              onDragEnd={handleDragEnd}
            >
              <section
                aria-label="任务看板"
                onScroll={(event) => {
                  const board = event.currentTarget;
                  const left = board.getBoundingClientRect().left;
                  const closest = columns.reduce(
                    (best, column) => {
                      const distance = Math.abs(
                        (document
                          .getElementById(`column-${column.id}`)
                          ?.getBoundingClientRect().left ?? Infinity) -
                          left -
                          16,
                      );
                      return distance < best.distance
                        ? { id: column.id, distance }
                        : best;
                    },
                    { id: mobileColumn, distance: Infinity },
                  );
                  setMobileColumn(closest.id);
                }}
                className={cn(
                  '-mx-4 flex gap-2 overflow-x-auto px-4 pb-5 scroll-px-4 overscroll-x-contain [scrollbar-width:none] sm:-mx-2 sm:gap-3 sm:px-2 sm:pb-6 sm:scroll-px-2 [&::-webkit-scrollbar]:hidden',
                  activeId ? 'snap-none' : 'snap-x snap-mandatory',
                )}
              >
                {columns.map((column) => (
                  <BoardColumn
                    key={column.id}
                    column={column}
                    tasks={groupSameColumnTaskFamilies(
                      orderedColumnTasks(visibleTasks, column.id),
                      column.id,
                    )}
                    onAdd={setComposer}
                    onOpenTask={openTask}
                    onArchiveTask={(task) => void archiveTaskFromCard(task)}
                    archiveDisabled={taskLifecycleSaving}
                    filtered={hasFilters}
                    progressByParent={progressByParent}
                    indicator={
                      dropIndicator?.status === column.id
                        ? dropIndicator
                        : undefined
                    }
                  />
                ))}
              </section>
              <DragOverlay dropAnimation={dropAnimation}>
                {activeTask ? (
                  <TaskCardOverlay
                    task={activeTask}
                    progress={progressByParent.get(activeTask.id)}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
            <footer className="flex flex-col items-start justify-between gap-2 border-t border-ink/10 pt-4 text-[11px] text-ink-faint sm:flex-row sm:items-center">
              <p className="sm:hidden">轻点卡片编辑 · 长按整张卡推进任务</p>
              <p className="hidden sm:block">
                点击卡片编辑 · 拖动整张卡推进工作
              </p>
              <p>
                {auth.user
                  ? `@${auth.user.login} · 3 秒内自动同步`
                  : '演示模式 · 可自由编辑，刷新后重置。'}
              </p>
            </footer>
          </>
        )}
      </div>

      {projectComposerOpen && (
        <div className="fixed inset-0 z-50 grid items-end bg-ink/20 backdrop-blur-[2px] sm:place-items-center sm:p-4">
          <form
            onSubmit={createNewProject}
            className="w-full max-w-md rounded-t-[28px] border border-b-0 border-ink/10 bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_24px_80px_rgba(20,20,15,0.18)] sm:rounded-[24px] sm:border-b sm:pb-5"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/10 sm:hidden" />
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-faint">新的工作空间</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">
                  创建项目
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setProjectComposerOpen(false)}
                aria-label="关闭"
              >
                <X />
              </Button>
            </div>
            <Input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              aria-label="项目名称"
              placeholder="例如：Kanby v1"
              maxLength={80}
              className="h-12 rounded-xl border-ink/15 px-4 text-base focus-visible:border-ink/30 focus-visible:ring-0"
            />
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-ink-faint">创建后可以邀请团队成员</p>
              <Button
                type="submit"
                disabled={!newProjectName.trim()}
                className="rounded-full bg-acid px-5 text-ink hover:bg-acid/80"
              >
                创建 <ArrowUpRight />
              </Button>
            </div>
          </form>
        </div>
      )}

      {memberManagerOpen && activeProject && (
        <div className="fixed inset-0 z-50 grid items-end bg-ink/20 backdrop-blur-[2px] sm:place-items-center sm:p-4">
          <section
            className="w-full max-w-lg rounded-t-[28px] border border-b-0 border-ink/10 bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_24px_80px_rgba(20,20,15,0.18)] sm:rounded-[24px] sm:border-b sm:pb-5"
            aria-labelledby="members-title"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/10 sm:hidden" />
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-xs text-ink-faint">{activeProject.name}</p>
                <h2
                  id="members-title"
                  className="mt-1 text-xl font-semibold tracking-tight"
                >
                  团队成员
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setMemberManagerOpen(false)}
                aria-label="关闭"
              >
                <X />
              </Button>
            </div>
            {activeProject.role === 'owner' && (
              <form onSubmit={inviteMember} className="mb-5 flex gap-2">
                <div className="relative flex-1">
                  <UserPlus className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                  <Input
                    value={newMemberIdentity}
                    onChange={(event) =>
                      setNewMemberIdentity(event.target.value)
                    }
                    placeholder="GitHub 用户名或邮箱"
                    className="h-11 rounded-xl border-ink/15 pl-9 focus-visible:border-ink/30 focus-visible:ring-0"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!newMemberIdentity.trim()}
                  className="h-11 rounded-xl bg-ink px-4 text-background hover:bg-ink/80"
                >
                  添加
                </Button>
              </form>
            )}
            <div className="max-h-[45dvh] space-y-1 overflow-y-auto">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-xl px-2 py-2.5 hover:bg-ink/[0.03]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Owner
                      user={
                        member.pending
                          ? {
                              id: member.id,
                              login: member.login,
                              name: '?',
                              avatarUrl: null,
                            }
                          : member
                      }
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {member.pending ? member.login : member.name}
                      </p>
                      <p className="truncate text-[11px] text-ink-faint">
                        {member.pending
                          ? '等待首次 GitHub 登录'
                          : `@${member.login}`}{' '}
                        · {member.role === 'owner' ? '所有者' : '成员'}
                      </p>
                    </div>
                  </div>
                  {activeProject.role === 'owner' &&
                    member.role !== 'owner' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full text-ink-faint hover:text-[#9d3026]"
                        onClick={() => removeMember(member.id)}
                        aria-label={`移除 ${member.login}`}
                      >
                        <X />
                      </Button>
                    )}
                </div>
              ))}
              {members.length === 0 && (
                <p className="py-8 text-center text-xs text-ink-faint">
                  成员加载中…
                </p>
              )}
            </div>
            <p className="mt-4 border-t border-ink/10 pt-4 text-[11px] leading-5 text-ink-faint">
              邀请会在对方首次使用对应 GitHub 用户名或已验证邮箱登录时自动生效。
            </p>
          </section>
        </div>
      )}

      {archiveOpen && (
        <div className="fixed inset-0 z-50 grid items-end sm:place-items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]"
            onClick={() => setArchiveOpen(false)}
            aria-label="关闭任务归档"
          />
          <dialog
            open
            aria-labelledby="archive-title"
            className="relative m-0 max-h-[82dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-b-0 border-ink/10 bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_24px_80px_rgba(20,20,15,0.18)] sm:m-auto sm:rounded-[24px] sm:border-b sm:p-6"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/10 sm:hidden" />
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-xs text-ink-faint">可恢复的任务</p>
                <h2
                  id="archive-title"
                  className="mt-1 text-xl font-semibold tracking-tight"
                >
                  任务归档
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setArchiveOpen(false)}
                aria-label="关闭"
              >
                <X />
              </Button>
            </div>
            <div className="space-y-2">
              {archivedTasks.map((task) => (
                <article
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-canvas p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {task.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                      <TaskOwnerGroup task={task} />
                      <span>
                        {taskOwners(task)
                          .map((owner) => `@${owner.login}`)
                          .join('、')}
                      </span>
                      {task.archivedAt && (
                        <span>
                          {isDemo
                            ? '刚刚'
                            : new Date(task.archivedAt).toLocaleDateString(
                                'zh-CN',
                              )}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={taskLifecycleSaving}
                      onClick={() => void restoreArchivedTask(task)}
                      className="rounded-full"
                      aria-label={`恢复 ${task.title}`}
                    >
                      <RotateCcw />
                    </Button>
                    {(isDemo || activeProject?.role === 'owner') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={taskLifecycleSaving}
                        onClick={() => void deleteArchivedTask(task)}
                        className="rounded-full text-ink-faint hover:text-[#9d3026]"
                        aria-label={`永久删除 ${task.title}`}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </article>
              ))}
              {archivedTasks.length === 0 && (
                <div className="grid min-h-32 place-items-center rounded-2xl border border-dashed border-ink/10 text-center text-xs text-ink-faint">
                  归档是空的
                </div>
              )}
            </div>
            <p className="mt-4 border-t border-ink/10 pt-4 text-[11px] leading-5 text-ink-faint">
              归档可随时恢复；只有项目所有者可以永久删除，且删除无法撤销。
            </p>
          </dialog>
        </div>
      )}

      {taskDraft && (
        <div className="fixed inset-0 z-50 grid items-end sm:place-items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]"
            onClick={() => void closeTaskEditor()}
            aria-label="保存并关闭任务详情"
          />
          <form
            onSubmit={finishTaskEditing}
            className="relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] border border-b-0 border-ink/10 bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_24px_80px_rgba(20,20,15,0.18)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-[24px] sm:border-b sm:p-6 lg:max-w-[1120px]"
            aria-labelledby="task-editor-title"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/10 sm:hidden" />
            <div className="mb-5 flex shrink-0 items-start justify-between">
              <div>
                <p className="text-xs text-ink-faint">
                  任务详情 · 自动保存
                  {editedTask?.number ? ` · KANBY-${editedTask.number}` : ''}
                </p>
                <h2
                  id="task-editor-title"
                  className="mt-1 text-xl font-semibold tracking-tight"
                >
                  编辑任务
                </h2>
                {editedTask?.parent ? (
                  <span className="mt-2 inline-flex max-w-[min(70vw,32rem)] items-center gap-1.5 rounded-full border border-child-border bg-child-surface px-2.5 py-1 text-[10px] font-semibold text-ink-subtle">
                    <ListTree className="size-3 shrink-0" />
                    <span className="shrink-0">子任务</span>
                    <span className="text-child-accent">·</span>
                    <span className="truncate">{editedTask.parent.title}</span>
                  </span>
                ) : progressByParent.get(taskDraft.id) ? (
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-acid/50 bg-acid/15 px-2.5 py-1 text-[10px] font-semibold text-ink">
                    <ListTree aria-hidden="true" className="size-3" />
                    父任务 · {progressByParent.get(taskDraft.id)?.total}{' '}
                    个子任务
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => void closeTaskEditor()}
                aria-label="保存并关闭"
              >
                <X />
              </Button>
            </div>
            <div className="-mx-1 grid min-h-0 flex-1 gap-5 overflow-y-auto px-1 pb-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] lg:items-start lg:gap-6">
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="task-title">标题</Label>
                  <Input
                    id="task-title"
                    value={taskDraft.title}
                    onChange={(event) =>
                      setTaskDraft((current) =>
                        current
                          ? { ...current, title: event.target.value }
                          : current,
                      )
                    }
                    maxLength={160}
                    className="h-11 rounded-xl border-ink/15 px-3 focus-visible:border-ink/30 focus-visible:ring-0"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="task-note">描述</Label>
                    <button
                      type="button"
                      className="text-xs font-medium text-ink-faint transition-colors hover:text-ink"
                      onClick={() => setNoteEditing((current) => !current)}
                    >
                      {noteEditing ? '预览' : '编辑 Markdown'}
                    </button>
                  </div>
                  {noteEditing ? (
                    <Textarea
                      id="task-note"
                      value={taskDraft.note}
                      onFocus={() =>
                        setTaskDraft((current) =>
                          current
                            ? {
                                ...current,
                                note: clearStarterTaskNote(current.note),
                              }
                            : current,
                        )
                      }
                      onChange={(event) =>
                        setTaskDraft((current) =>
                          current
                            ? { ...current, note: event.target.value }
                            : current,
                        )
                      }
                      maxLength={2000}
                      placeholder="支持 Markdown；验收条件请添加到右侧验收清单"
                      className="min-h-52 resize-y rounded-xl border-ink/15 px-3 font-mono text-sm focus-visible:border-ink/30 focus-visible:ring-0"
                    />
                  ) : clearStarterTaskNote(taskDraft.note) ? (
                    <div className="min-h-28 w-full rounded-xl border border-ink/10 bg-canvas/60 px-3 py-3 text-left">
                      <TaskMarkdown>
                        {clearStarterTaskNote(taskDraft.note)}
                      </TaskMarkdown>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="min-h-28 w-full rounded-xl border border-ink/10 bg-canvas/60 px-3 py-3 text-left text-sm text-ink-faint transition-colors hover:border-ink/20"
                      onClick={() => setNoteEditing(true)}
                    >
                      添加描述，支持 Markdown
                    </button>
                  )}
                  <p className="text-[10px] text-ink-faint">
                    描述用于上下文；可验证的完成条件请使用验收清单。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="task-status">状态</Label>
                    <Select
                      value={taskDraft.status}
                      onValueChange={(value) =>
                        value &&
                        setTaskDraft((current) =>
                          current
                            ? { ...current, status: value as ColumnId }
                            : current,
                        )
                      }
                    >
                      <SelectTrigger
                        id="task-status"
                        className="h-11 w-full rounded-xl border-ink/15"
                      >
                        <SelectValue>
                          {
                            columns.find(
                              (column) => column.id === taskDraft.status,
                            )?.title
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((column) => (
                          <SelectItem key={column.id} value={column.id}>
                            {column.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="task-tag">标签</Label>
                    <Select
                      value={taskDraft.tag}
                      onValueChange={(value) =>
                        value &&
                        setTaskDraft((current) =>
                          current
                            ? { ...current, tag: value as TaskTag }
                            : current,
                        )
                      }
                    >
                      <SelectTrigger
                        id="task-tag"
                        className="h-11 w-full rounded-xl border-ink/15"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {taskTags.map((tag) => (
                          <SelectItem key={tag} value={tag}>
                            {tag}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label>负责人</Label>
                      <span className="text-[10px] text-ink-faint">
                        {taskDraft.ownerIds.length}/3
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {assignableMembers.map((member) => {
                        const selected = taskDraft.ownerIds.includes(member.id);
                        const disabled =
                          (selected && taskDraft.ownerIds.length === 1) ||
                          (!selected && taskDraft.ownerIds.length >= 3);
                        return (
                          <div
                            key={member.id}
                            className={cn(
                              'flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors',
                              selected
                                ? 'border-acid/70 bg-acid/10'
                                : 'border-ink/10 bg-canvas',
                              disabled && 'opacity-55',
                            )}
                          >
                            <Checkbox
                              checked={selected}
                              disabled={disabled}
                              aria-label={`${selected ? '移除' : '添加'}负责人 ${member.name}`}
                              onCheckedChange={() =>
                                setTaskDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        ownerIds: toggleTaskOwnerIds(
                                          current.ownerIds,
                                          member.id,
                                        ),
                                      }
                                    : current,
                                )
                              }
                            />
                            <MemberIdentity user={member} />
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-ink-faint">
                      至少保留 1 位，最多选择 3 位项目成员
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>截止日</Label>
                  <Popover open={duePickerOpen} onOpenChange={setDuePickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            'h-11 w-full justify-start rounded-xl border-ink/15 px-3 text-left font-normal hover:bg-canvas',
                            !taskDraft.due && 'text-ink-faint',
                          )}
                          aria-label={
                            taskDraft.due
                              ? `截止日 ${taskDueLabel(taskDraft.due)}，点击修改`
                              : '选择截止日期'
                          }
                        >
                          <CalendarDays className="size-4 text-ink-faint" />
                          <span className="flex-1">
                            {taskDueLabel(taskDraft.due)}
                          </span>
                          <ChevronDown className="size-4 text-ink-faint" />
                        </Button>
                      }
                    />
                    <PopoverContent
                      align="start"
                      className="w-auto rounded-2xl border-ink/10 bg-card p-2 shadow-[0_18px_60px_rgba(20,20,15,0.16)]"
                    >
                      <Calendar
                        mode="single"
                        locale={zhCN}
                        selected={parseTaskDueDate(taskDraft.due)}
                        defaultMonth={
                          parseTaskDueDate(taskDraft.due) ?? new Date()
                        }
                        onSelect={(date) => {
                          if (!date) return;
                          setTaskDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  due: serializeTaskDueDate(date),
                                }
                              : current,
                          );
                          setDuePickerOpen(false);
                        }}
                      />
                      <div className="flex items-center justify-between border-t border-ink/10 px-1 pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setTaskDraft((current) =>
                              current ? { ...current, due: '' } : current,
                            );
                            setDuePickerOpen(false);
                          }}
                          disabled={!taskDraft.due}
                          className="rounded-lg text-ink-subtle"
                        >
                          清除日期
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setTaskDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    due: serializeTaskDueDate(new Date()),
                                  }
                                : current,
                            );
                            setDuePickerOpen(false);
                          }}
                          className="rounded-lg font-semibold"
                        >
                          今天
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <section
                  className="space-y-3 rounded-2xl border border-ink/10 bg-canvas/70 p-4"
                  aria-labelledby="acceptance-checklist-title"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label
                        id="acceptance-checklist-title"
                        className="flex items-center gap-2"
                      >
                        <ListChecks className="size-4" /> 验收清单
                      </Label>
                      <p className="mt-1 text-[10px] text-ink-faint">
                        写清楚做到什么才算完成
                      </p>
                    </div>
                    {(editedTask?.acceptanceCriteria?.length ?? 0) > 0 && (
                      <span className="rounded-full bg-card px-2.5 py-1 text-[10px] font-semibold text-ink-subtle">
                        {editedTask?.acceptanceCriteria?.filter(
                          (item) => item.completed,
                        ).length ?? 0}
                        /{editedTask?.acceptanceCriteria?.length ?? 0} 已达成
                      </span>
                    )}
                  </div>
                  {(editedTask?.acceptanceCriteria?.length ?? 0) === 0 ? (
                    <div className="rounded-xl border border-dashed border-ink/15 bg-card px-3 py-4 text-center text-[11px] text-ink-faint">
                      暂无验收条件，先添加第一条
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {editedTask?.acceptanceCriteria?.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            'group flex items-center gap-2 rounded-xl border border-transparent bg-card px-3 py-2 transition-colors focus-within:border-ink/15',
                            item.completed && 'bg-acid/10',
                          )}
                        >
                          <Checkbox
                            checked={item.completed}
                            disabled={Boolean(acceptanceSaving)}
                            onCheckedChange={(checked) =>
                              void updateAcceptanceItem(item, {
                                completed: checked,
                              })
                            }
                            className="size-5 rounded-md data-checked:border-acid data-checked:bg-acid data-checked:text-ink"
                            aria-label={
                              item.completed
                                ? `取消完成：${item.body}`
                                : `完成：${item.body}`
                            }
                          />
                          <Input
                            key={`${item.id}:${item.updatedAt}`}
                            defaultValue={item.body}
                            disabled={acceptanceSaving === item.id}
                            maxLength={240}
                            onBlur={(event) => {
                              const body = event.currentTarget.value.trim();
                              if (!body) {
                                event.currentTarget.value = item.body;
                                return;
                              }
                              void updateAcceptanceItem(item, { body });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                              if (event.key === 'Escape') {
                                event.currentTarget.value = item.body;
                                event.currentTarget.blur();
                              }
                            }}
                            className={cn(
                              'h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0',
                              item.completed &&
                                'text-ink-faint line-through decoration-ink/30',
                            )}
                            aria-label="验收条件"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={Boolean(acceptanceSaving)}
                            onClick={() => void removeAcceptanceItem(item)}
                            className="shrink-0 rounded-full text-ink-faint opacity-60 hover:text-[#9d3026] group-hover:opacity-100"
                            aria-label={`删除验收条件：${item.body}`}
                          >
                            {acceptanceSaving === item.id ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <Trash2 />
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 border-t border-ink/10 pt-3">
                    <Input
                      value={acceptanceDraft}
                      onChange={(event) =>
                        setAcceptanceDraft(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void addAcceptanceCriterion();
                        }
                      }}
                      disabled={
                        Boolean(acceptanceSaving) ||
                        (editedTask?.acceptanceCriteria?.length ?? 0) >= 20
                      }
                      maxLength={240}
                      placeholder="例如：移动端可完成整个流程"
                      className="h-10 rounded-xl border-ink/15 bg-card px-3 text-xs focus-visible:ring-0"
                      aria-label="新增验收条件"
                    />
                    <Button
                      type="button"
                      size="icon"
                      disabled={
                        !acceptanceDraft.trim() ||
                        Boolean(acceptanceSaving) ||
                        (editedTask?.acceptanceCriteria?.length ?? 0) >= 20
                      }
                      onClick={() => void addAcceptanceCriterion()}
                      className="size-10 shrink-0 rounded-xl bg-ink text-background"
                      aria-label="添加验收条件"
                    >
                      {acceptanceSaving === 'new' ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Plus />
                      )}
                    </Button>
                  </div>
                </section>
                {editedTask?.parent ? (
                  <section className="rounded-2xl border border-child-border bg-child-surface p-4">
                    <div className="flex items-center gap-2 text-xs font-medium text-ink-subtle">
                      <ListTree aria-hidden="true" className="size-3" />{' '}
                      所属父任务
                    </div>
                    <button
                      type="button"
                      disabled={!editedParent}
                      onClick={() =>
                        editedParent && void openRelatedTask(editedParent)
                      }
                      className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl bg-card px-3 py-3 text-left transition-colors enabled:hover:bg-ink/[0.04] disabled:cursor-default"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">
                          {editedTask.parent.title}
                        </span>
                        <span className="mt-1 block text-[10px] text-ink-faint">
                          {editedTask.parent.archived
                            ? '父任务已归档'
                            : '打开父任务'}
                        </span>
                      </span>
                      {!editedTask.parent.archived && (
                        <ArrowUpRight className="size-3.5 shrink-0 text-ink-faint" />
                      )}
                    </button>
                  </section>
                ) : editedTask ? (
                  <section
                    className="space-y-3 rounded-2xl border border-acid/35 bg-parent-surface p-4"
                    aria-labelledby="subtasks-title"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label
                          id="subtasks-title"
                          className="flex items-center gap-2"
                        >
                          <ListTree aria-hidden="true" className="size-3" />{' '}
                          子任务
                        </Label>
                        <p className="mt-1 text-[10px] text-ink-faint">
                          子任务是看板上可独立推进的卡片
                        </p>
                      </div>
                      {progressByParent.get(editedTask.id) && (
                        <span className="rounded-full bg-card px-2.5 py-1 text-[10px] font-semibold text-ink-subtle">
                          {progressByParent.get(editedTask.id)?.done}/
                          {progressByParent.get(editedTask.id)?.total} 已完成
                        </span>
                      )}
                    </div>
                    {editedSubtasks.length > 0 && (
                      <div className="space-y-1.5">
                        {editedSubtasks.map((subtask) => (
                          <div
                            key={subtask.id}
                            className="flex items-center gap-2 rounded-xl border border-child-border bg-child-surface p-2"
                          >
                            <button
                              type="button"
                              disabled={subtaskStatusSaving === subtask.id}
                              onClick={() => void toggleSubtaskStatus(subtask)}
                              className={cn(
                                'grid size-8 shrink-0 place-items-center rounded-full border transition-colors',
                                subtask.status === 'shipped'
                                  ? 'border-acid bg-acid text-ink'
                                  : 'border-ink/15 text-ink-faint hover:border-ink/30 hover:text-ink',
                              )}
                              aria-label={
                                subtask.status === 'shipped'
                                  ? `将 ${subtask.title} 标为待开始`
                                  : `完成 ${subtask.title}`
                              }
                            >
                              {subtaskStatusSaving === subtask.id ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : subtask.status === 'shipped' ? (
                                <Check className="size-3.5" />
                              ) : (
                                <Circle className="size-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void openRelatedTask(subtask)}
                              className="min-w-0 flex-1 rounded-lg px-1 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-acid"
                            >
                              <span
                                className={cn(
                                  'block truncate text-xs font-medium',
                                  subtask.status === 'shipped' &&
                                    'text-ink-faint line-through',
                                )}
                              >
                                {subtask.title}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-ink-faint">
                                {
                                  columns.find(
                                    (column) => column.id === subtask.status,
                                  )?.title
                                }
                              </span>
                            </button>
                            <ArrowUpRight className="mr-1 size-3.5 shrink-0 text-ink-faint" />
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="space-y-2 border-t border-ink/10 pt-3">
                      <Label htmlFor="split-task-titles" className="text-xs">
                        拆分卡片
                      </Label>
                      <Textarea
                        id="split-task-titles"
                        value={splitTitles}
                        onChange={(event) => setSplitTitles(event.target.value)}
                        placeholder={'设计空状态\n接入数据接口\n补充发布检查'}
                        className="min-h-24 resize-y rounded-xl border-ink/15 bg-card px-3 text-sm focus-visible:ring-0"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] text-ink-faint">
                          每行一个，最多 20 个
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!splitTitles.trim() || taskSplitting}
                          onClick={() => void splitCurrentTask()}
                          className="rounded-full bg-ink px-4 text-background"
                        >
                          {taskSplitting ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <ListTree />
                          )}
                          拆分为子任务
                        </Button>
                      </div>
                    </div>
                  </section>
                ) : null}
                {!isDemo && (
                  <div className="space-y-3 rounded-2xl border border-ink/10 bg-canvas p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="github-item-url">
                          GitHub Issue / PR
                        </Label>
                        <p className="mt-1 text-[10px] text-ink-faint">
                          Webhook 会同步状态、合并结果和 CI。
                        </p>
                      </div>
                      <GitBranch className="size-4 text-ink-faint" />
                    </div>
                    {editedTask?.githubLink ? (
                      <div className="rounded-xl bg-card p-3">
                        <div className="flex items-start justify-between gap-3">
                          <a
                            href={editedTask.githubLink.url}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0"
                          >
                            <p className="truncate text-xs font-semibold">
                              {editedTask.githubLink.title}
                            </p>
                            <p className="mt-1 truncate text-[10px] text-ink-faint">
                              {editedTask.githubLink.repository} #
                              {editedTask.githubLink.number} ·{' '}
                              {editedTask.githubLink.state}
                              {editedTask.githubLink.ciStatus
                                ? ` · CI ${editedTask.githubLink.ciStatus}`
                                : ''}
                            </p>
                          </a>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={githubLinkSaving}
                            onClick={() => void unlinkGitHubItem()}
                            className="shrink-0 rounded-full text-ink-faint"
                          >
                            移除
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          id="github-item-url"
                          value={githubLinkUrl}
                          onChange={(event) =>
                            setGithubLinkUrl(event.target.value)
                          }
                          placeholder="https://github.com/org/repo/issues/123"
                          className="h-10 rounded-xl border-ink/15 bg-card px-3 text-xs focus-visible:ring-0"
                        />
                        <Button
                          type="button"
                          disabled={githubLinkSaving || !githubLinkUrl.trim()}
                          onClick={() => void linkGitHubItem()}
                          className="h-10 shrink-0 rounded-xl bg-ink text-background"
                        >
                          {githubLinkSaving && (
                            <LoaderCircle className="animate-spin" />
                          )}
                          关联
                        </Button>
                      </div>
                    )}
                    {!editedTask?.githubLink && (
                      <Link
                        href={`/settings?project=${encodeURIComponent(activeProjectId ?? '')}`}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-subtle hover:text-ink"
                      >
                        先在设置中启用仓库 <ArrowUpRight className="size-3" />
                      </Link>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-5 lg:border-l lg:border-ink/10 lg:pl-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>附件</Label>
                    <span className="text-[11px] text-ink-faint">
                      {editedTask?.attachments?.length ?? 0}/10 · 单个最大 10 MB
                    </span>
                  </div>
                  {Boolean(editedTask?.attachments?.length) && (
                    <div className="grid grid-cols-2 gap-2">
                      {editedTask?.attachments?.map((attachment) =>
                        isPreviewableImage(attachment) ? (
                          <div
                            key={attachment.id}
                            className="group/attachment relative overflow-hidden rounded-xl border border-ink/10 bg-canvas"
                          >
                            <a
                              href={appResourceUrl(attachment.url)}
                              target="_blank"
                              rel="noreferrer"
                              className="block"
                              aria-label={`打开图片 ${attachment.name}`}
                            >
                              <Image
                                src={appResourceUrl(attachment.url)}
                                alt={attachment.name}
                                width={640}
                                height={360}
                                unoptimized
                                className="h-28 w-full object-cover sm:h-32"
                              />
                              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                                <span className="truncate text-[11px] font-medium">
                                  {attachment.name}
                                </span>
                                <span className="shrink-0 text-[10px] text-ink-faint">
                                  {formatFileSize(attachment.size)}
                                </span>
                              </div>
                            </a>
                            <button
                              type="button"
                              onClick={() =>
                                void removeTaskAttachment(attachment)
                              }
                              className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-ink/70 text-background opacity-100 backdrop-blur-sm transition-opacity hover:bg-ink sm:opacity-0 sm:group-hover/attachment:opacity-100"
                              aria-label={`删除 ${attachment.name}`}
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div
                            key={attachment.id}
                            className="col-span-2 flex items-center gap-3 rounded-xl border border-ink/10 bg-canvas p-3"
                          >
                            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink/5 text-ink-subtle">
                              <FileText className="size-4" />
                            </div>
                            <a
                              href={appResourceUrl(attachment.url)}
                              target="_blank"
                              rel="noreferrer"
                              className="min-w-0 flex-1"
                            >
                              <p className="truncate text-xs font-medium">
                                {attachment.name}
                              </p>
                              <p className="mt-0.5 text-[10px] text-ink-faint">
                                {formatFileSize(attachment.size)}
                              </p>
                            </a>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0 rounded-full text-ink-faint"
                              onClick={() =>
                                void removeTaskAttachment(attachment)
                              }
                              aria-label={`删除 ${attachment.name}`}
                            >
                              <X />
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => attachmentInput.current?.click()}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setAttachmentDragActive(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                      setAttachmentDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      )
                        setAttachmentDragActive(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setAttachmentDragActive(false);
                      void uploadTaskAttachments(event.dataTransfer.files);
                    }}
                    className={cn(
                      'flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ink/15 bg-canvas px-4 py-4 text-center outline-none transition-colors hover:border-ink/30 focus-visible:border-ink/30 focus-visible:ring-2 focus-visible:ring-acid',
                      attachmentDragActive && 'border-acid bg-acid/10',
                      attachmentUploading && 'pointer-events-none opacity-60',
                    )}
                  >
                    {attachmentUploading ? (
                      <LoaderCircle className="mb-2 size-5 animate-spin text-ink-subtle" />
                    ) : (
                      <Upload className="mb-2 size-5 text-ink-subtle" />
                    )}
                    <span className="text-xs font-medium">
                      {attachmentUploading
                        ? '正在上传附件…'
                        : '拖拽文件到这里，或点击选择'}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-ink-faint">
                      <ImageIcon className="size-3" /> 图片会自动生成预览
                    </span>
                  </button>
                  <input
                    ref={attachmentInput}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={(event) =>
                      event.target.files &&
                      void uploadTaskAttachments(event.target.files)
                    }
                  />
                </div>
                <section
                  className="space-y-3 border-t border-ink/10 pt-5 lg:border-t-0 lg:pt-0"
                  aria-labelledby="task-activity-title"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label id="task-activity-title">活动</Label>
                      <p className="mt-1 text-[10px] text-ink-faint">
                        成员、Coding Agent 与 GitHub 的最新进展
                      </p>
                    </div>
                    {editedTask?.agentState && (
                      <span className="flex max-w-[55%] items-center gap-1.5 rounded-full bg-acid/15 px-2.5 py-1 text-[10px] font-medium text-ink">
                        <span className="size-1.5 shrink-0 rounded-full bg-acid" />
                        <Bot className="size-3 shrink-0" />
                        <span className="truncate">
                          {editedTask.agentState.agentName} 正在处理
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="rounded-2xl bg-canvas p-3">
                    {taskActivityLoading && taskActivity.length === 0 ? (
                      <div className="grid min-h-20 place-items-center">
                        <LoaderCircle className="size-4 animate-spin text-ink-faint" />
                      </div>
                    ) : taskActivity.length > 0 ? (
                      <div className="space-y-0">
                        {taskActivity.map((activity, index) => (
                          <article
                            key={activity.id}
                            className={cn(
                              'relative flex gap-3 rounded-xl pb-4 last:pb-1',
                              activity.kind.startsWith('github.ci.') &&
                                isFailingCiStatus(
                                  activity.kind.slice('github.ci.'.length),
                                ) &&
                                'mb-2 bg-[#c94032]/8 p-2 text-[#9d3026]',
                            )}
                          >
                            {index < taskActivity.length - 1 && (
                              <span className="absolute bottom-0 left-4 top-8 w-px bg-ink/10" />
                            )}
                            {activity.source === 'github' ? (
                              <span
                                className={cn(
                                  'relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-card text-ink-subtle ring-1 ring-ink/10',
                                  activity.kind.startsWith('github.ci.') &&
                                    isFailingCiStatus(
                                      activity.kind.slice('github.ci.'.length),
                                    ) &&
                                    'text-[#9d3026] ring-[#c94032]/30',
                                )}
                              >
                                {activity.kind.startsWith('github.ci.') &&
                                isFailingCiStatus(
                                  activity.kind.slice('github.ci.'.length),
                                ) ? (
                                  <CircleAlert className="size-3.5" />
                                ) : (
                                  <GitBranch className="size-3.5" />
                                )}
                              </span>
                            ) : activity.source === 'agent' ? (
                              <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-acid/25 text-ink ring-1 ring-acid/40">
                                <Bot className="size-3.5" />
                              </span>
                            ) : (
                              <Avatar
                                size="sm"
                                className="relative z-10 shrink-0"
                              >
                                <AvatarImage
                                  src={activity.actor.avatarUrl ?? undefined}
                                  alt=""
                                />
                                <AvatarFallback className="bg-card text-[10px] font-semibold ring-1 ring-ink/10">
                                  {activity.actor.name
                                    .slice(0, 1)
                                    .toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div className="min-w-0 flex-1 pt-0.5">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[11px] font-medium leading-4 text-ink">
                                  {activity.summary}
                                </p>
                                <time className="shrink-0 text-[9px] text-ink-faint">
                                  {taskActivityTime(activity.createdAt)}
                                </time>
                              </div>
                              {activity.body && (
                                <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-ink-subtle">
                                  {activity.body}
                                </p>
                              )}
                              {typeof activity.metadata?.url === 'string' && (
                                <a
                                  href={activity.metadata.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-ink-subtle hover:text-ink"
                                >
                                  查看 GitHub{' '}
                                  <ArrowUpRight className="size-3" />
                                </a>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="grid min-h-20 place-items-center text-center text-[11px] text-ink-faint">
                        还没有活动
                      </div>
                    )}
                    {taskActivityCursor && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={taskActivityLoading}
                        onClick={() => void loadOlderTaskActivity()}
                        className="mt-2 w-full rounded-xl text-[11px] text-ink-faint"
                      >
                        {taskActivityLoading && (
                          <LoaderCircle className="animate-spin" />
                        )}
                        加载更早活动
                      </Button>
                    )}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor="task-comment" className="sr-only">
                        写一条评论
                      </Label>
                      <Textarea
                        id="task-comment"
                        value={taskComment}
                        onChange={(event) => setTaskComment(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            (event.metaKey || event.ctrlKey) &&
                            event.key === 'Enter'
                          ) {
                            event.preventDefault();
                            void submitTaskComment();
                          }
                        }}
                        maxLength={2000}
                        placeholder="写一条评论…"
                        className="min-h-11 resize-none rounded-xl border-ink/15 px-3 py-2.5 text-sm focus-visible:ring-0"
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      disabled={!taskComment.trim() || taskCommentSaving}
                      onClick={() => void submitTaskComment()}
                      className="shrink-0 rounded-xl bg-ink text-background"
                      aria-label="发送评论"
                    >
                      {taskCommentSaving ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Send />
                      )}
                    </Button>
                  </div>
                  <p className="flex items-center gap-1 text-[10px] text-ink-faint">
                    <MessageCircle className="size-3" /> ⌘/Ctrl + Enter 发送
                  </p>
                </section>
              </div>
            </div>
            <div className="mt-5 flex shrink-0 items-center justify-between gap-3 border-t border-ink/10 pt-4">
              <div className="flex min-w-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={taskLifecycleSaving || taskSaving}
                  onClick={() => void archiveCurrentTask()}
                  className="shrink-0 rounded-full px-2 text-ink-faint hover:text-ink"
                >
                  <Archive /> 归档
                </Button>
                <p className="hidden items-center gap-1.5 text-[11px] text-ink-faint sm:flex">
                  {taskSaving && (
                    <LoaderCircle className="size-3 animate-spin" />
                  )}
                  {taskSaving
                    ? '正在自动保存…'
                    : taskHasUnsavedChanges
                      ? '等待自动保存…'
                      : '所有修改已保存'}
                </p>
              </div>
              <Button
                type="submit"
                disabled={
                  taskLifecycleSaving ||
                  !taskDraft.title.trim() ||
                  taskDraft.ownerIds.length < 1
                }
                className="rounded-full bg-acid px-5 text-ink hover:bg-acid/80"
              >
                完成
              </Button>
            </div>
          </form>
        </div>
      )}

      {composer && (
        <div className="fixed inset-0 z-50 grid items-end bg-ink/20 backdrop-blur-[2px] sm:place-items-center sm:p-4">
          <form
            onSubmit={addTask}
            className="w-full max-w-md rounded-t-[28px] border border-b-0 border-ink/10 bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_24px_80px_rgba(20,20,15,0.18)] sm:rounded-[24px] sm:border-b sm:pb-5"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/10 sm:hidden" />
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-faint">
                  添加到 ·{' '}
                  {columns.find((column) => column.id === composer)?.title}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">
                  下一件要做的事
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setComposer(null)}
                aria-label="关闭"
              >
                <X />
              </Button>
            </div>
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              aria-label="任务标题"
              placeholder="例如：发布首个可用版本"
              className="h-12 rounded-xl border-ink/15 px-4 text-base focus-visible:border-ink/30 focus-visible:ring-0"
            />
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <Owner user={auth.user ?? demoUsers.you} /> 默认分配给你
              </div>
              <Button
                type="submit"
                disabled={!newTitle.trim()}
                className="rounded-full bg-acid px-5 text-ink hover:bg-acid/80"
              >
                创建任务 <ArrowUpRight />
              </Button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
