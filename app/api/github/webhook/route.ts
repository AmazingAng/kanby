import {
  failGitHubDelivery,
  finishGitHubDelivery,
  startGitHubDelivery,
} from '@/lib/github-db';
import { getGitHubAppConfig, verifyGitHubWebhook } from '@/lib/github';
import { processGitHubWebhook } from '@/lib/github-webhook';
import { readTextBodyWithLimit } from '@/lib/request-limits';

export const dynamic = 'force-dynamic';
const MAX_WEBHOOK_BODY = 1024 * 1024;

export async function POST(request: Request) {
  const config = getGitHubAppConfig();
  if (!config)
    return Response.json({ error: 'GitHub App unavailable' }, { status: 503 });
  const body = await readTextBodyWithLimit(request, MAX_WEBHOOK_BODY);
  if (!body.ok)
    return Response.json(
      {
        error:
          body.reason === 'too_large'
            ? 'Payload too large'
            : 'Unreadable payload',
      },
      { status: body.reason === 'too_large' ? 413 : 400 },
    );
  if (
    !(await verifyGitHubWebhook(
      body.text,
      request.headers.get('x-hub-signature-256'),
      config.webhookSecret,
    ))
  )
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  const event = request.headers.get('x-github-event') ?? '';
  const deliveryId = request.headers.get('x-github-delivery') ?? '';
  if (!event || !deliveryId || event.length > 80 || deliveryId.length > 100)
    return Response.json({ error: 'Missing headers' }, { status: 400 });
  let source: { installationId?: string; repositoryId?: string } | undefined;
  try {
    const payload = JSON.parse(body.text) as {
      installation?: { id?: number };
      repository?: { id?: number };
    };
    source = {
      installationId: payload.installation?.id
        ? String(payload.installation.id)
        : undefined,
      repositoryId: payload.repository?.id
        ? String(payload.repository.id)
        : undefined,
    };
  } catch {
    source = undefined;
  }
  if (!(await startGitHubDelivery(deliveryId, event, body.text, source)))
    return Response.json({ ok: true, duplicate: true });
  try {
    const result = await processGitHubWebhook(event, deliveryId, body.text);
    await finishGitHubDelivery(deliveryId);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    await failGitHubDelivery(deliveryId, error);
    return Response.json({ ok: true, queued: true }, { status: 202 });
  }
}
