import { describe, expect, it } from 'vitest';

import {
  appResourceUrl,
  withAppBasePath,
  withoutAppBasePath,
} from '@/lib/app-path';

const previewBasePath = '/w/702a5b1647a3/preview';

describe('application base path', () => {
  it('prefixes browser-native navigation paths once', () => {
    expect(withAppBasePath('/11/board', previewBasePath)).toBe(
      '/w/702a5b1647a3/preview/11/board',
    );
    expect(
      withAppBasePath('/w/702a5b1647a3/preview/11/board', previewBasePath),
    ).toBe('/w/702a5b1647a3/preview/11/board');
  });

  it('preserves query strings on API navigation', () => {
    expect(
      withAppBasePath(
        '/api/github/connect?projectId=project-1',
        previewBasePath,
      ),
    ).toBe('/w/702a5b1647a3/preview/api/github/connect?projectId=project-1');
  });

  it('removes the deployment prefix before parsing a project slug', () => {
    expect(
      withoutAppBasePath('/w/702a5b1647a3/preview/11/board', previewBasePath),
    ).toBe('/11/board');
    expect(withoutAppBasePath('/11/board', '')).toBe('/11/board');
  });

  it('keeps browser-owned and absolute resource URLs unchanged', () => {
    expect(appResourceUrl('blob:https://example.test/file')).toBe(
      'blob:https://example.test/file',
    );
    expect(appResourceUrl('https://cdn.example.test/file.png')).toBe(
      'https://cdn.example.test/file.png',
    );
  });
});
