'use client';

import { useMemo, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpRight,
  Check,
  Circle,
  Clock3,
  GripVertical,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarGroup } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ColumnId = 'ideas' | 'building' | 'shipped';
type MemberId = 'lin' | 'mika' | 'you';

type Task = {
  id: string;
  title: string;
  note: string;
  tag: '产品' | '设计' | '代码' | '增长';
  owner: MemberId;
  due?: string;
  status: ColumnId;
};

const members: Record<MemberId, { name: string; initials: string; color: string }> = {
  lin: { name: 'Lin', initials: 'L', color: 'bg-[#f3b59f] text-[#542b1e]' },
  mika: { name: 'Mika', initials: 'M', color: 'bg-[#b8d7ff] text-[#15345c]' },
  you: { name: 'You', initials: 'Y', color: 'bg-[#d8ff63] text-[#253000]' },
};

const columns: { id: ColumnId; title: string; hint: string }[] = [
  { id: 'ideas', title: '待开始', hint: '下一步做什么' },
  { id: 'building', title: '进行中', hint: '保持专注，≤ 3' },
  { id: 'shipped', title: '已完成', hint: '这周交付的' },
];

const initialTasks: Task[] = [
  { id: 'task-1', title: '梳理新用户 onboarding', note: '把首次价值体验压缩到 60 秒内', tag: '产品', owner: 'lin', due: '今天', status: 'building' },
  { id: 'task-2', title: '实现 Command 菜单', note: '⌘K 快速创建与跳转', tag: '代码', owner: 'you', due: '周五', status: 'building' },
  { id: 'task-3', title: '重写定价页标题', note: '说人话，少一点功能列表', tag: '增长', owner: 'mika', status: 'ideas' },
  { id: 'task-4', title: '空状态插画', note: '只保留一个让人行动的提示', tag: '设计', owner: 'lin', due: '下周一', status: 'ideas' },
  { id: 'task-5', title: '接入错误监控', note: '生产环境异常自动聚合', tag: '代码', owner: 'you', status: 'ideas' },
  { id: 'task-6', title: '邀请 5 位种子用户', note: '记录首次使用的卡点', tag: '增长', owner: 'mika', status: 'shipped' },
  { id: 'task-7', title: '发布 v0.1', note: '核心流程可以稳定跑通', tag: '产品', owner: 'you', status: 'shipped' },
];

function Owner({ id, label = false }: { id: MemberId; label?: boolean }) {
  const member = members[id];
  return (
    <div className="flex items-center gap-2">
      <Avatar size="sm" aria-label={member.name}>
        <AvatarFallback className={cn('font-semibold', member.color)}>{member.initials}</AvatarFallback>
      </Avatar>
      {label && <span className="text-xs text-ink-subtle">{member.name}</span>}
    </div>
  );
}

function TaskCard({ task, overlay = false }: { task: Task; overlay?: boolean }) {
  const sortable = useSortable({ id: task.id, disabled: overlay });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

  return (
    <article
      ref={sortable.setNodeRef}
      style={style}
      {...sortable.attributes}
      {...sortable.listeners}
      className={cn(
        'group relative cursor-grab touch-none rounded-[18px] border bg-card p-4 outline-none transition-[box-shadow,border-color,opacity] active:cursor-grabbing',
        'hover:border-ink/25 hover:shadow-[0_10px_30px_rgba(30,30,24,0.06)] focus-visible:ring-2 focus-visible:ring-acid',
        sortable.isDragging && 'opacity-30',
        overlay && 'rotate-[1.5deg] border-ink/20 shadow-[0_20px_50px_rgba(20,20,15,0.16)]',
      )}
    >
      <GripVertical className="absolute right-3 top-3 size-4 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
      <Badge variant="outline" className="mb-3 border-ink/10 bg-canvas text-[10px] font-medium text-ink-subtle">{task.tag}</Badge>
      <h3 className="pr-5 text-[15px] font-semibold leading-5 tracking-[-0.01em]">{task.title}</h3>
      <p className="mt-1.5 text-[12px] leading-[1.55] text-ink-subtle">{task.note}</p>
      <div className="mt-4 flex items-center justify-between">
        <Owner id={task.owner} />
        {task.due ? <span className="flex items-center gap-1 text-[11px] text-ink-subtle"><Clock3 className="size-3" /> {task.due}</span> : <span className="text-[11px] text-ink-faint">无截止日</span>}
      </div>
    </article>
  );
}

function BoardColumn({ column, tasks, onAdd }: { column: (typeof columns)[number]; tasks: Task[]; onAdd: (status: ColumnId) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section ref={setNodeRef} className={cn('flex min-h-[520px] min-w-[288px] flex-1 snap-start flex-col rounded-[22px] border border-transparent p-2 transition-colors', isOver && 'border-acid/70 bg-acid-wash')} aria-labelledby={`${column.id}-title`}>
      <div className="mb-3 flex items-start justify-between px-2 pt-1">
        <div>
          <div className="flex items-center gap-2"><h2 id={`${column.id}-title`} className="text-sm font-semibold">{column.title}</h2><span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-semibold text-ink-subtle">{tasks.length}</span></div>
          <p className="mt-1 text-[11px] text-ink-faint">{column.hint}</p>
        </div>
        <Button variant="ghost" size="icon-sm" className="rounded-full text-ink-subtle" onClick={() => onAdd(column.id)} aria-label={`添加到${column.title}`}><Plus /></Button>
      </div>
      <SortableContext items={tasks.map((task) => task.id)} strategy={rectSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2.5">
          {tasks.map((task) => <TaskCard key={task.id} task={task} />)}
          {tasks.length === 0 && <button onClick={() => onAdd(column.id)} className="flex min-h-28 items-center justify-center rounded-[18px] border border-dashed border-ink/15 text-xs text-ink-faint transition-colors hover:border-ink/30 hover:text-ink-subtle"><Plus className="mr-1.5 size-3.5" /> 添加第一项</button>}
        </div>
      </SortableContext>
    </section>
  );
}

export default function Home() {
  const [tasks, setTasks] = useState(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState<MemberId | 'all'>('all');
  const [composer, setComposer] = useState<ColumnId | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const activeTask = tasks.find((task) => task.id === activeId);
  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => (memberFilter === 'all' || task.owner === memberFilter) && (!query || `${task.title} ${task.note} ${task.tag}`.toLowerCase().includes(query)));
  }, [tasks, memberFilter, search]);
  const doneCount = tasks.filter((task) => task.status === 'shipped').length;
  const progress = Math.round((doneCount / tasks.length) * 100);

  function handleDragStart(event: DragStartEvent) { setActiveId(String(event.active.id)); }
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeIndex = tasks.findIndex((task) => task.id === active.id);
    if (activeIndex === -1) return;
    const overId = String(over.id);
    const overIndex = tasks.findIndex((task) => task.id === overId);
    const targetStatus = columns.some((column) => column.id === overId) ? (overId as ColumnId) : overIndex >= 0 ? tasks[overIndex].status : tasks[activeIndex].status;
    setTasks((current) => {
      const from = current.findIndex((task) => task.id === active.id);
      const to = current.findIndex((task) => task.id === overId);
      const updated = current.map((task) => task.id === active.id ? { ...task, status: targetStatus } : task);
      return to >= 0 ? arrayMove(updated, from, to) : updated;
    });
  }
  function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!newTitle.trim() || !composer) return;
    setTasks((current) => [...current, { id: `task-${Date.now()}`, title: newTitle.trim(), note: '刚刚创建，补充一点上下文吧', tag: '产品', owner: 'you', status: composer }]);
    setNewTitle(''); setComposer(null);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1480px] px-4 pb-10 sm:px-6 lg:px-8">
        <header className="flex h-20 items-center justify-between border-b border-ink/10">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-[10px] bg-ink text-background"><Sparkles className="size-4" /></div>
            <div><div className="flex items-center gap-2"><span className="text-[15px] font-bold tracking-[-0.02em]">tinyship</span><span className="hidden text-ink-faint sm:inline">/</span><button className="hidden items-center gap-1 text-[13px] font-medium text-ink-subtle hover:text-ink sm:flex">Side Project <ArrowUpRight className="size-3" /></button></div><p className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">Build less. Ship more.</p></div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <AvatarGroup>{(Object.keys(members) as MemberId[]).map((id) => <button key={id} onClick={() => setMemberFilter(memberFilter === id ? 'all' : id)} aria-label={`筛选 ${members[id].name}`}><Avatar size="sm" className={cn(memberFilter === id && 'ring-2 ring-ink')}><AvatarFallback className={cn('font-semibold', members[id].color)}>{members[id].initials}</AvatarFallback></Avatar></button>)}</AvatarGroup>
            <span className="hidden h-5 w-px bg-ink/10 sm:block" /><Button className="rounded-full bg-ink px-4 text-background hover:bg-ink/80" onClick={() => setComposer('ideas')}><Plus /> 新任务</Button>
          </div>
        </header>

        <div className="flex flex-col gap-5 py-7 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint"><Circle className="size-2.5 fill-acid text-acid" /> 2026 · 第 36 周</div><h1 className="text-[clamp(2rem,4vw,3.4rem)] font-semibold leading-none tracking-[-0.055em]">这周，做成什么？</h1></div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-56"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务..." className="h-9 rounded-full border-ink/10 bg-card pl-9 shadow-none focus-visible:border-ink/20 focus-visible:ring-0" /></div>
            <div className="flex min-w-52 items-center gap-3 rounded-full border border-ink/10 bg-card px-4 py-2"><div className="flex-1"><div className="mb-1 flex justify-between text-[10px] font-medium text-ink-subtle"><span>本周进度</span><span>{progress}%</span></div><div className="h-1 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-acid transition-all" style={{ width: `${progress}%` }} /></div></div><Check className="size-4 text-ink-subtle" /></div>
          </div>
        </div>

        {memberFilter !== 'all' && <div className="mb-4 flex items-center gap-2 text-xs text-ink-subtle">正在看 <Owner id={memberFilter} label /> 的任务 <button onClick={() => setMemberFilter('all')} className="rounded-full p-1 hover:bg-ink/5" aria-label="清除筛选"><X className="size-3" /></button></div>}
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="-mx-2 flex snap-x gap-1 overflow-x-auto pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {columns.map((column) => <BoardColumn key={column.id} column={column} tasks={visibleTasks.filter((task) => task.status === column.id)} onAdd={setComposer} />)}
          </div>
          <DragOverlay>{activeTask ? <TaskCard task={activeTask} overlay /> : null}</DragOverlay>
        </DndContext>
        <footer className="flex flex-col items-start justify-between gap-2 border-t border-ink/10 pt-4 text-[11px] text-ink-faint sm:flex-row sm:items-center"><p>拖动卡片来推进工作 · 按 Space 可用键盘移动</p><p>少开会，多交付。</p></footer>
      </div>

      {composer && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/20 p-4 backdrop-blur-[2px]" onMouseDown={(event) => event.currentTarget === event.target && setComposer(null)}><form onSubmit={addTask} className="w-full max-w-md rounded-[24px] border border-ink/10 bg-card p-5 shadow-[0_24px_80px_rgba(20,20,15,0.18)]"><div className="mb-5 flex items-center justify-between"><div><p className="text-xs text-ink-faint">添加到 · {columns.find((column) => column.id === composer)?.title}</p><h2 className="mt-1 text-xl font-semibold tracking-tight">下一件要做的事</h2></div><Button type="button" variant="ghost" size="icon" className="rounded-full" onClick={() => setComposer(null)} aria-label="关闭"><X /></Button></div><Input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="例如：发布首个可用版本" className="h-12 rounded-xl border-ink/15 px-4 text-base focus-visible:border-ink/30 focus-visible:ring-0" /><div className="mt-4 flex items-center justify-between"><div className="flex items-center gap-2 text-xs text-ink-faint"><Owner id="you" /> 默认分配给你</div><Button type="submit" disabled={!newTitle.trim()} className="rounded-full bg-acid px-5 text-ink hover:bg-acid/80">创建任务 <ArrowUpRight /></Button></div></form></div>}
    </main>
  );
}
