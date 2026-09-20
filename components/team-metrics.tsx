'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { TeamMetrics } from '@/lib/team-metrics';

function lastWeek() {
  const now = new Date();
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7),
  );
  const local = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const first = new Date(monday);
  first.setDate(first.getDate() - 7);
  const last = new Date(monday);
  last.setDate(last.getDate() - 1);
  return {
    from: local(first),
    to: local(last),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
export function TeamMetricsDialog({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(lastWeek);
  const [query, setQuery] = useState(range);
  const [report, setReport] = useState<TeamMetrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/metrics?${new URLSearchParams({ projectId, ...query })}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok: boolean;
          data: TeamMetrics;
          error?: { message?: string };
        };
        if (!response.ok || !payload.ok)
          throw new Error(payload.error?.message ?? '无法读取统计');
        if (!controller.signal.aborted) setReport(payload.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '无法读取统计');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, projectId, query]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setLoading(true);
          setError('');
          setReport(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="团队交付统计"
            className="rounded-full text-ink-faint"
          />
        }
      >
        <BarChart3 />
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{projectName} · 团队交付</DialogTitle>
          <DialogDescription>
            按顶层任务统计，子任务不重复计数。任务数量不代表工作难度、工时或个人绩效。
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setLoading(true);
            setError('');
            setReport(null);
            setQuery({ ...range });
          }}
        >
          <label className="text-sm">
            开始日期
            <input
              className="mt-1 block rounded border px-2 py-1.5"
              type="date"
              required
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </label>
          <label className="text-sm">
            结束日期（含）
            <input
              className="mt-1 block rounded border px-2 py-1.5"
              type="date"
              required
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </label>
          <label className="text-sm">
            时区
            <input
              className="mt-1 block w-40 rounded border px-2 py-1.5"
              required
              value={range.timezone}
              onChange={(e) => setRange({ ...range, timezone: e.target.value })}
            />
          </label>
          <Button type="submit" disabled={loading}>
            {loading ? '计算中…' : '查看统计'}
          </Button>
        </form>
        <div aria-live="polite">
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {loading && (
            <p className="text-sm text-ink-subtle">正在读取任务与成员历史…</p>
          )}
        </div>
        {report && (
          <>
            <p className="text-xs text-ink-subtle">
              {report.period.from} 至 {report.period.to} ·{' '}
              {report.period.timeZone}
              {report.period.provisional ? ' · 进行中，数据截至当前' : ''}
            </p>
            {!report.coverage.complete && (
              <output className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                历史不足：可靠采集始于{' '}
                {new Date(report.coverage.from).toLocaleString('zh-CN', {
                  timeZone: report.period.timeZone,
                })}
                。下方数量仅为已观察记录，完成率与人均交付量暂不可计算。
              </output>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="观察到的交付量"
                value={`${report.team.throughput} 项`}
                detail="期内进入完成，且截至期末仍完成"
              />
              <Metric
                label="计划完成率"
                value={
                  report.team.completionRate === null
                    ? '暂无可靠数据'
                    : `${(report.team.completionRate * 100).toFixed(1)}%`
                }
                detail={`${report.team.plannedCompleted} / ${report.team.planned} 项期初已计划任务`}
              />
              <Metric
                label="人均交付量"
                value={
                  report.team.perMemberThroughput === null
                    ? '暂无可靠数据'
                    : report.team.perMemberThroughput.toFixed(2)
                }
                detail={`${report.team.memberEquivalents.toFixed(2)} 个成员周期，含零产出成员`}
              />
            </div>
            <p className="text-sm text-ink-subtle">
              计划分母固定为期初未完成、当时截止日在本期的任务；后续改期或归档不会缩小分母。交付指看板完成，不等同于生产上线。
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="mb-2 text-left font-medium">
                  成员交付分摊（非排名）
                </caption>
                <thead>
                  <tr className="border-b">
                    <th className="py-2">成员</th>
                    <th>参与周期</th>
                    <th>交付份额</th>
                  </tr>
                </thead>
                <tbody>
                  {report.people.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="py-2">{p.name}</td>
                      <td>{p.memberEquivalent.toFixed(2)}</td>
                      <td>{p.completionCredit.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.people.length && (
                <p className="py-3 text-sm text-ink-subtle">
                  本期没有可用的成员记录。
                </p>
              )}
            </div>
            <p className="text-xs text-ink-subtle">
              按成员在本期内的在组时长折算参与周期；多人负责的任务按完成时负责人平分，后续转交不改写归属。
            </p>
            <div className="rounded-lg border p-3 text-sm leading-7">
              <p>数据质量（截至统计截止时刻）</p>
              <p>
                已完成但验收项未全勾选：
                {report.quality.uncheckedCompleted.length}{' '}
                项；无验收清单的已完成任务：
                {report.quality.completedWithoutChecklist.length} 项。
              </p>
              <p>
                已完成但仍有未完成子任务：
                {report.quality.completedWithOpenChildren.length}{' '}
                项；未设置截止日的在办任务：
                {report.quality.openWithoutDeadline.length} 项。
              </p>
              <p>
                本期重开：{report.team.reopened} 项。可测周期中位数：
                {report.team.medianCycleHours === null
                  ? '暂无数据'
                  : `${report.team.medianCycleHours.toFixed(1)} 小时`}
                （{report.team.cycleSampleSize}{' '}
                项有完整开始记录；不代表实际工时）。
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className="my-2 text-2xl font-semibold">{value}</p>
      <p className="text-xs text-ink-subtle">{detail}</p>
    </div>
  );
}
