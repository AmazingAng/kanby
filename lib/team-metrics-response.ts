import { MetricInputError, metricPeriod } from '@/lib/team-metrics';
import { MetricCapacityError, readTeamMetrics } from '@/lib/team-metrics-store';

export async function metricsResponse(request: Request, projectId: string) {
  const params = new URL(request.url).searchParams;
  try {
    const period = metricPeriod(
      params.get('from') ?? '',
      params.get('to') ?? '',
      params.get('timezone') ?? 'UTC',
    );
    return Response.json(
      { ok: true, data: await readTeamMetrics(projectId, period) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (
      error instanceof MetricInputError ||
      error instanceof MetricCapacityError
    )
      return Response.json(
        {
          ok: false,
          error: {
            code:
              error instanceof MetricInputError
                ? 'invalid_period'
                : 'history_limit',
            message: error.message,
          },
        },
        {
          status: error instanceof MetricInputError ? 400 : 422,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    throw error;
  }
}
