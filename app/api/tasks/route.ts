import { getAuthConfig, getSessionUser, isSameOriginMutation } from '@/lib/auth';
import { createTask, listTasks, reorderTasks, type ColumnId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const statuses = new Set<ColumnId>(['ideas', 'building', 'shipped']);

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json({ tasks: await listTasks() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as { title?: unknown; status?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const status = typeof body.status === 'string' && statuses.has(body.status as ColumnId) ? (body.status as ColumnId) : null;
  if (!title || title.length > 160 || !status) return Response.json({ error: 'Invalid task' }, { status: 400 });
  return Response.json({ task: await createTask(user, { title, status }) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as { items?: unknown };
  if (!Array.isArray(body.items) || body.items.length > 500) return Response.json({ error: 'Invalid order' }, { status: 400 });
  const items = body.items.map((item) => {
    const value = item as { id?: unknown; status?: unknown; position?: unknown };
    if (typeof value.id !== 'string' || value.id.length > 80 || typeof value.status !== 'string' || !statuses.has(value.status as ColumnId) || !Number.isInteger(value.position) || Number(value.position) < 0) return null;
    return { id: value.id, status: value.status as ColumnId, position: Number(value.position) };
  });
  if (items.some((item) => item === null)) return Response.json({ error: 'Invalid order' }, { status: 400 });
  await reorderTasks(items as { id: string; status: ColumnId; position: number }[]);
  return Response.json({ ok: true });
}
