import { authenticateAgent } from '@/lib/agent';
import { listTurnQueue, unreadCounts } from '@/lib/turns';

export const dynamic = 'force-dynamic';

/**
 * What an agent should look at first: cards whose turn is this agent, any
 * agent of its member, or the member personally, plus open @mentions, each
 * with the number of conversation entries written since this token last read
 * the card. Read-only; reading a card with `GET /api/v1/tasks?id=` advances
 * the cursor.
 */
export async function GET(request: Request) {
  const identity = await authenticateAgent(request, 'task:read');
  if (!identity)
    return Response.json(
      {
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'Invalid, expired, or insufficiently scoped Agent Token',
        },
      },
      { status: 401 },
    );
  const items = await listTurnQueue({
    projectId: identity.projectId,
    userId: identity.userId,
    tokenId: identity.tokenId,
  });
  const counts = await unreadCounts(
    identity.projectId,
    items.map((item) => item.taskId),
    identity.tokenId,
  );
  const now = Date.now();
  const withCounts = items.map((item) => ({
    ...item,
    waitingMs: Math.max(0, now - item.since),
    unreadCount: counts.get(item.taskId) ?? 0,
  }));
  return Response.json(
    {
      ok: true,
      data: {
        member: {
          id: identity.userId,
          login: identity.userLogin,
          name: identity.userName,
        },
        agent: {
          tokenId: identity.tokenId,
          name: identity.agentName,
          label: `${identity.userName} 的 ${identity.agentName}`,
        },
        turns: withCounts.filter((item) => item.type === 'turn'),
        mentions: withCounts.filter((item) => item.type === 'mention'),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
