import { describe, expect, it } from 'vitest';

import {
  resolveSettingsProject,
  settingsProjectPath,
} from '@/lib/settings-project';

const projects = [{ id: 'tinyship' }, { id: 'xapi' }];

describe('settings project selection', () => {
  it('restores the project requested by the URL', () => {
    expect(resolveSettingsProject(projects, '?project=xapi')).toEqual({
      id: 'xapi',
    });
  });

  it('falls back safely when the URL has no accessible project', () => {
    expect(resolveSettingsProject(projects, '?release=current')).toEqual({
      id: 'tinyship',
    });
    expect(resolveSettingsProject(projects, '?project=missing')).toEqual({
      id: 'tinyship',
    });
    expect(resolveSettingsProject([], '?project=xapi')).toBeNull();
  });

  it('persists the project while preserving unrelated query state and hashes', () => {
    expect(
      settingsProjectPath(
        'https://kanby.example/settings?release=abc&project=old#members',
        'xapi/project',
      ),
    ).toBe('/settings?release=abc&project=xapi%2Fproject#members');
  });
});
