import {
  AcceptanceCriterionRevisionConflictError,
  getProjectRole,
  getTask,
  listProjects,
  listTasks,
  TaskRevisionConflictError,
  updateAcceptanceCriterion,
  updateTask,
} from '@/lib/db';
import { listTaskActivity, userActivityActor } from '@/lib/task-activity';
import { listTurnQueue, postTaskComment, userCollabActor } from '@/lib/turns';
import {
  MiniError,
  miniBody,
  miniBoundary,
  miniJson,
  miniRateLimit,
  miniString,
  miniUser,
} from '@/lib/weixin-mini';
export const dynamic = 'force-dynamic';
async function project(userId: string, value: unknown) {
  const id = miniString(value);
  if (!(await getProjectRole(id, userId)))
    throw new MiniError(403, '没有此项目的访问权限');
  return id;
}
async function taskInProject(projectId: string, value: unknown) {
  const id = miniString(value);
  const task = await getTask(projectId, id);
  if (!task) throw new MiniError(404, '卡片不存在或已归档');
  return task;
}
export async function GET(request: Request) {
  return miniBoundary(async () => {
    const user = await miniUser(request);
    const query = new URL(request.url).searchParams;
    if (!query.has('projectId'))
      return miniJson({ user, projects: await listProjects(user.id) });
    const projectId = await project(user.id, query.get('projectId'));
    if (!query.has('taskId') && query.get('view') === 'board')
      return miniJson({ tasks: await listTasks(projectId) });
    if (!query.has('taskId'))
      return miniJson({
        items: await listTurnQueue({ projectId, userId: user.id }),
      });
    const task = await taskInProject(projectId, query.get('taskId'));
    let activity;
    try {
      activity = await listTaskActivity({
        projectId,
        taskId: task.id,
        cursor: query.get('cursor'),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid activity cursor')
        throw new MiniError(400, '无效的活动分页');
      throw error;
    }
    return miniJson({
      task,
      activity: { items: activity.events, nextCursor: activity.nextCursor },
    });
  });
}
function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new MiniError(400, '缺少卡片版本，请刷新');
  return value;
}
export async function POST(request: Request) {
  return miniBoundary(async () => {
    const user = await miniUser(request);
    const body = await miniBody(request);
    const projectId = await project(user.id, body.projectId);
    const task = await taskInProject(projectId, body.taskId);
    await miniRateLimit(`write:${user.id}`, 60);
    if (body.action === 'comment') {
      const result = await postTaskComment({
        projectId,
        taskId: task.id,
        body: miniString(body.body, 2000),
        actor: userCollabActor(user),
      });
      return miniJson({ event: result.event }, 201);
    }
    if (body.action !== 'check' && body.action !== 'accept')
      throw new MiniError(400, '未知的卡片操作');
    const expected = revision(body.updatedAt);
    if (task.updatedAt !== expected)
      throw new MiniError(409, '卡片已更新，请刷新后重试');
    try {
      if (body.action === 'check') {
        if (typeof body.completed !== 'boolean')
          throw new MiniError(400, '无效的验收项状态');
        const result = await updateAcceptanceCriterion(
          projectId,
          task.id,
          {
            id: miniString(body.id),
            completed: body.completed,
            expectedUpdatedAt: revision(body.itemUpdatedAt),
            expectedTaskUpdatedAt: expected,
          },
          userActivityActor(user),
        );
        if (!result) throw new MiniError(404, '验收项不存在');
        return miniJson(result);
      }
      if (
        task.status !== 'building' ||
        task.acceptanceCriteria.some((item) => !item.completed)
      )
        throw new MiniError(409, '请先完成开发和全部验收项');
      const result = await updateTask(projectId, {
        id: task.id,
        title: task.title,
        note: task.note,
        tag: task.tag,
        ownerId: task.owner.id,
        ownerIds: task.owners.map((owner) => owner.id),
        due: task.due,
        status: 'shipped',
        expectedUpdatedAt: expected,
        activity: { actor: userActivityActor(user) },
      });
      if (!result) throw new MiniError(409, '卡片或负责人已变化，请刷新');
      return miniJson({ task: result });
    } catch (error) {
      if (
        error instanceof TaskRevisionConflictError ||
        error instanceof AcceptanceCriterionRevisionConflictError
      )
        throw new MiniError(409, '卡片已更新，请刷新后重试');
      throw error;
    }
  });
}
