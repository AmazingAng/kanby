import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TaskMarkdown } from '@/components/task-markdown';

describe('task Markdown', () => {
  it('renders GFM without exposing raw HTML or unsafe links', () => {
    const html = renderToStaticMarkup(
      <TaskMarkdown>{`# Project

## Release

### Checklist

- **safe** item
- [x] checked

1. First

> Note with \`inline code\`

\`\`\`ts
const ready = true;
\`\`\`

| State | Result |
| --- | --- |
| ready | yes |

[docs](https://example.com) [bad](javascript:alert(1))

<script>alert('xss')</script>`}</TaskMarkdown>,
    );

    expect(html).toContain('>Release</h2>');
    expect(html).toContain('>Project</h1>');
    expect(html).toContain('>Checklist</h3>');
    expect(html).toContain('<strong>safe</strong>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<pre');
    expect(html).toContain('<table');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });

  it('marks compact Markdown for a bounded card excerpt', () => {
    const html = renderToStaticMarkup(
      <TaskMarkdown compact>{'First\n\nSecond\n\nThird'}</TaskMarkdown>,
    );

    expect(html).toContain('data-compact="true"');
    expect(html).toContain('max-h-');
    expect(html).toContain('overflow-hidden');
  });
});
