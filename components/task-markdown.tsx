import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

export function TaskMarkdown({
  children,
  compact = false,
}: {
  children: string;
  compact?: boolean;
}) {
  return (
    <div
      data-compact={compact ? 'true' : undefined}
      className={cn(
        'task-markdown min-w-0 text-ink-subtle',
        compact
          ? 'relative max-h-[4.65rem] overflow-hidden text-[12px] leading-[1.55]'
          : 'text-sm leading-6',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children: label, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
            >
              {label}
            </a>
          ),
          h1: ({ children: value }) => (
            <h1 className="mb-2 mt-4 text-xl font-semibold text-ink first:mt-0">
              {value}
            </h1>
          ),
          h2: ({ children: value }) => (
            <h2 className="mb-2 mt-4 text-lg font-semibold text-ink first:mt-0">
              {value}
            </h2>
          ),
          h3: ({ children: value }) => (
            <h3 className="mb-1.5 mt-3 font-semibold text-ink first:mt-0">
              {value}
            </h3>
          ),
          p: ({ children: value }) => (
            <p className="mb-2 break-words last:mb-0">{value}</p>
          ),
          ul: ({ children: value }) => (
            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{value}</ul>
          ),
          ol: ({ children: value }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
              {value}
            </ol>
          ),
          li: ({ children: value, className }) => (
            <li className={cn('break-words', className)}>{value}</li>
          ),
          blockquote: ({ children: value }) => (
            <blockquote className="mb-2 border-l-2 border-ink/20 pl-3 text-ink-faint last:mb-0">
              {value}
            </blockquote>
          ),
          code: ({ children: value, className }) => (
            <code
              className={cn(
                'rounded bg-ink/[0.06] px-1 py-0.5 font-mono text-[0.9em] text-ink',
                className,
              )}
            >
              {value}
            </code>
          ),
          pre: ({ children: value }) => (
            <pre className="mb-2 overflow-x-auto rounded-xl bg-ink/[0.06] p-3 text-xs last:mb-0">
              {value}
            </pre>
          ),
          table: ({ children: value }) => (
            <div className="mb-2 overflow-x-auto rounded-xl border border-ink/10 last:mb-0">
              <table className="w-full border-collapse text-left text-xs">
                {value}
              </table>
            </div>
          ),
          th: ({ children: value }) => (
            <th className="border-b border-ink/10 bg-ink/[0.04] px-2 py-1.5 font-semibold text-ink">
              {value}
            </th>
          ),
          td: ({ children: value }) => (
            <td className="border-b border-ink/[0.06] px-2 py-1.5 last:border-b-0">
              {value}
            </td>
          ),
          input: (props) => (
            <input
              {...props}
              disabled
              className="mr-1.5 align-middle accent-ink"
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
