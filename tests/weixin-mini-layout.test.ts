import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync('miniprogram/pages/index/index.wxml', 'utf8');
const styles = readFileSync('miniprogram/app.wxss', 'utf8');
describe('native mini layout contracts', () => {
  it('opts every button out of the native fixed non-mini width and resets mini sizing with higher specificity', () => {
    const buttons = [...template.matchAll(/<button\b[^>]*>/g)];
    expect(buttons.length).toBeGreaterThan(10);
    for (const [tag] of buttons) expect(tag).toContain('size="mini"');
    expect(styles).toMatch(/\.page button\[size='mini'\]\s*\{[^}]*width: 100%/);
    expect(styles).toMatch(
      /\.page button\.account-button\[size='mini'\]\s*\{[^}]*width: auto/,
    );
    expect(styles).toMatch(
      /\.page button\.criterion\[size='mini'\]\s*\{[^}]*width: 100%/,
    );
  });
  it('shows a full nickname and exposes both queue and board navigation', () => {
    expect(template).toContain('{{user.name}}');
    expect(template).toContain('data-view="queue"');
    expect(template).toContain('data-view="board"');
    expect(template).toContain('scroll-x="{{true}}"');
    expect(template).toContain('{{column.label}}');
    expect(template).toContain('{{selectedPreview.title');
  });
});
