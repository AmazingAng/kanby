import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import { SessionError, textField } from '@/lib/interaction-sessions';
import { appendSessionEvent } from '@/lib/interaction-sessions-store';
import {
  eventInput,
  readSessions,
  sessionBody,
  sessionFailure,
  sessionResponse,
} from '@/lib/interaction-sessions-response';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request),
      projectId = new URL(request.url).searchParams.get('projectId') ?? '';
    if (!user || !projectId || !(await getProjectRole(projectId, user.id)))
      throw new SessionError(403, 'Forbidden');
    return await readSessions(request, projectId);
  } catch (error) {
    return sessionFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const config = getAuthConfig(),
      user = await getSessionUser(request);
    if (!config || !user || !isSameOriginMutation(request, config))
      throw new SessionError(403, 'Forbidden');
    const body = await sessionBody(request),
      projectId = textField(body.projectId, 80, true)!;
    if (!(await getProjectRole(projectId, user.id)))
      throw new SessionError(403, 'Forbidden');
    return sessionResponse(
      await appendSessionEvent(
        projectId,
        user.id,
        'verified_user',
        eventInput(body, true),
      ),
    );
  } catch (error) {
    return sessionFailure(error);
  }
}
