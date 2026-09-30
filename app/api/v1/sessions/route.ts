import { authenticateAgent } from '@/lib/agent';
import { SessionError } from '@/lib/interaction-sessions';
import {
  readSessions,
  writeSessions,
  sessionFailure,
} from '@/lib/interaction-sessions-response';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const identity = await authenticateAgent(request, 'task:read');
    if (!identity)
      throw new SessionError(
        401,
        'Invalid, expired, or insufficiently scoped Agent Token',
      );
    return await readSessions(request, identity.projectId);
  } catch (error) {
    return sessionFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const identity = await authenticateAgent(request, 'task:write');
    if (!identity)
      throw new SessionError(
        401,
        'Invalid, expired, or insufficiently scoped Agent Token',
      );
    return await writeSessions(request, identity);
  } catch (error) {
    return sessionFailure(error);
  }
}
