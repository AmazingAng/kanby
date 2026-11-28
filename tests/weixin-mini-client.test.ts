import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
type Modal = { success(this: void, result: { confirm: boolean }): void };
function page(api: ReturnType<typeof vi.fn>, token = 'token') {
  type Data = {
    authenticated: boolean;
    projectId: string;
    task: { id: string; updatedAt?: number } | null;
    comment: string;
    error: string;
    busy: boolean;
    pairingCode: string;
  };
  type MiniPage = {
    data: Data;
    setData(update: Partial<Data>): void;
    onLoad(query: { projectId: string; taskId: string }): Promise<void>;
    login(): Promise<void>;
    comment(): Promise<void>;
    accept(): Promise<void>;
  };
  let definition: MiniPage;
  const storage = { token };
  const wx = {
    getStorageSync: vi.fn(() => storage.token),
    removeStorageSync: vi.fn(() => {
      storage.token = '';
    }),
    setStorageSync: vi.fn((_k: string, v: string) => {
      storage.token = v;
    }),
    login: vi.fn(
      ({ success }: { success(this: void, result: { code: string }): void }) =>
        success({ code: 'code' }),
    ),
    showModal: vi.fn(({ success }: Modal) => success({ confirm: true })),
    setClipboardData: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  };
  runInNewContext(readFileSync('miniprogram/pages/index/index.js', 'utf8'), {
    Page: (value: MiniPage) => {
      definition = value;
    },
    require: () => ({ api, tokenKey: 'miniToken' }),
    wx,
    console,
  });
  const instance = {
    ...definition!,
    data: structuredClone(definition!.data),
    setData(update: Partial<Data>) {
      Object.assign(this.data, update);
    },
  };
  return { instance, wx, storage };
}
describe('native mini page behavior', () => {
  const template = readFileSync('miniprogram/pages/index/index.wxml', 'utf8');
  // Check the actual template's condition against Page data, without pretending
  // this small expression harness implements WeChat layout or lifecycle.
  function visible(selector: RegExp, data: object) {
    const tag = template.match(selector)?.[0];
    if (!tag) throw new Error('Missing template region');
    const value = tag.match(/wx:(?:if|elif)="([^"]*)"/)?.[1];
    if (value === undefined) return true;
    const expression = value.match(/^\{\{([\s\S]*)\}\}$/)?.[1];
    return expression === undefined
      ? Boolean(value)
      : Boolean(runInNewContext(expression, data, { timeout: 100 }));
  }
  const loginRegion = /<view\b[^>]*id="login-panel"[^>]*>/;
  const pairingRegion = /<block\b[^>]*id="pairing-panel"[^>]*>/;
  it('binds all dynamic conditional directives instead of treating names as literal strings', () => {
    const values = [...template.matchAll(/wx:(?:if|elif)="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(values.length).toBeGreaterThan(10);
    for (const value of values) expect(value).toMatch(/^\{\{.+\}\}$/);
  });
  it('hides empty error and pairing panels on the initial login screen', () => {
    const { instance } = page(vi.fn(), '');
    expect(visible(/<view\b[^>]*class="error"[^>]*>/, instance.data)).toBe(
      false,
    );
    expect(visible(loginRegion, instance.data)).toBe(true);
    expect(visible(pairingRegion, instance.data)).toBe(false);
  });
  it('switches away from login and pairing after a bound user signs in', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'unlinked',
        pairingCode: 'my-pair-code',
        expiresAt: Date.now() + 300000,
      })
      .mockResolvedValueOnce({ status: 'linked', token: 'real-session' })
      .mockResolvedValueOnce({ projects: [], user: { name: 'Alice' } });
    const { instance, storage } = page(api, '');
    await instance.login();
    expect(instance.data.authenticated).toBe(false);
    expect(instance.data.pairingCode).toBe('my-pair-code');
    expect(visible(pairingRegion, instance.data)).toBe(true);
    await instance.login();
    expect(storage.token).toBe('real-session');
    expect(instance.data.authenticated).toBe(true);
    expect(visible(loginRegion, instance.data)).toBe(false);
    expect(visible(pairingRegion, instance.data)).toBe(false);
    expect(visible(/<view\b[^>]*class="error"[^>]*>/, instance.data)).toBe(
      false,
    );
  });
  it('only offers acceptance for a building card', () => {
    const acceptButton = /<button\b[^>]*bindtap="accept"[^>]*>/;
    expect(visible(acceptButton, { task: { status: 'building' } })).toBe(true);
    expect(visible(acceptButton, { task: { status: 'shipped' } })).toBe(false);
    expect(visible(acceptButton, { task: { status: 'ideas' } })).toBe(false);
  });
  it('omits absent activity bodies instead of rendering null', () => {
    const activityBody = /<text\b[^>]*class="event-body[^"]*"[^>]*>/;
    expect(visible(activityBody, { item: { body: null } })).toBe(false);
    expect(visible(activityBody, { item: { body: '' } })).toBe(false);
    expect(visible(activityBody, { item: { body: 'A real comment' } })).toBe(
      true,
    );
  });
  it('preserves notification task through first login and loads its detail', async () => {
    const api = vi.fn(async (path: string) =>
      path === 'auth'
        ? { status: 'linked', token: 'real-session' }
        : path === 'tasks'
          ? {
              projects: [{ id: 'p', name: 'Project' }],
              user: { name: 'Alice' },
            }
          : {
              task: { id: 't', title: 'Card', acceptanceCriteria: [] },
              activity: { items: [], nextCursor: null },
            },
    );
    const { instance, storage } = page(api, '');
    await instance.onLoad({ projectId: 'p', taskId: 't' });
    await instance.login();
    expect(storage.token).toBe('real-session');
    expect(instance.data.task?.id).toBe('t');
    expect(
      api.mock.calls.some(([url]) => url === 'tasks?projectId=p&taskId=t'),
    ).toBe(true);
  });
  it('keeps an unsent comment and clears expired authentication', async () => {
    const api = vi.fn(async () => {
      throw Object.assign(new Error('expired'), { status: 401 });
    });
    const { instance } = page(api);
    instance.setData({
      authenticated: true,
      projectId: 'p',
      task: { id: 't' },
      comment: 'keep me',
    });
    await instance.comment();
    expect(instance.data.comment).toBe('keep me');
    expect(instance.data.authenticated).toBe(false);
    expect(instance.data.error).toBe('expired');
  });
  it('requires confirmation for acceptance and blocks duplicate submits', async () => {
    const api = vi.fn(async () => ({}));
    const { instance, wx } = page(api);
    instance.setData({
      projectId: 'p',
      task: { id: 't', updatedAt: 123 },
      busy: true,
    });
    await instance.accept();
    expect(api).not.toHaveBeenCalled();
    instance.setData({ busy: false });
    wx.showModal.mockImplementation(({ success }: Modal) =>
      success({ confirm: false }),
    );
    await instance.accept();
    expect(api).not.toHaveBeenCalled();
    expect(instance.data.busy).toBe(false);
  });
});

describe('mini request transport', () => {
  function transport(
    statusCode = 200,
    configuredOrigin = 'https://kanby.test',
  ) {
    const calls: Array<{ url: string; header: Record<string, string> }> = [];
    const remove = vi.fn();
    const commonJsModule = {
      exports: {} as {
        api: (
          path: string,
          method?: string,
          data?: unknown,
        ) => Promise<unknown>;
      },
    };
    runInNewContext(readFileSync('miniprogram/utils/api.js', 'utf8'), {
      module: commonJsModule,
      require: () => ({ origin: configuredOrigin }),
      wx: {
        getStorageSync: () => 'km_test-session',
        removeStorageSync: remove,
        request: (options: {
          url: string;
          header: Record<string, string>;
          success: (response: { statusCode: number; data: unknown }) => void;
        }) => {
          calls.push(options);
          options.success({
            statusCode,
            data: statusCode === 200 ? { ok: true } : { error: 'denied' },
          });
        },
      },
    });
    return { api: commonJsModule.exports.api, calls, remove };
  }
  it('sends bearer only in headers and clears local credentials on 401', async () => {
    const good = transport();
    expect(await good.api('tasks')).toEqual({ ok: true });
    expect(good.calls[0]).toMatchObject({
      url: 'https://kanby.test/api/mini/tasks',
      header: { Authorization: 'Bearer km_test-session' },
    });
    const expired = transport(401);
    await expect(expired.api('tasks')).rejects.toMatchObject({ status: 401 });
    expect(expired.remove).toHaveBeenCalled();
    const forbidden = transport(403);
    await expect(forbidden.api('tasks')).rejects.toMatchObject({ status: 403 });
    expect(forbidden.remove).not.toHaveBeenCalled();
  });
  it('rejects arbitrary URLs and non-HTTPS deployment configuration', async () => {
    const good = transport();
    await expect(good.api('https://evil.test')).rejects.toThrow();
    expect(good.calls).toHaveLength(0);
    const insecure = transport(200, 'http://kanby.test');
    await expect(insecure.api('tasks')).rejects.toThrow();
    expect(insecure.calls).toHaveLength(0);
  });
  it('keeps every template event connected to an executable page handler', () => {
    const { instance } = page(vi.fn());
    const template = readFileSync('miniprogram/pages/index/index.wxml', 'utf8');
    const handlers = [
      ...template.matchAll(/bind(?:tap|input|change)="([A-Za-z]+)"/g),
    ].map((match) => match[1]!);
    expect(handlers.length).toBeGreaterThan(10);
    for (const handler of handlers)
      expect(
        typeof (instance as unknown as Record<string, unknown>)[handler],
      ).toBe('function');
    expect(template).not.toContain('<web-view');
    const config = JSON.parse(
      readFileSync('miniprogram/project.config.json', 'utf8'),
    ) as { setting: { urlCheck: boolean } };
    expect(config.setting.urlCheck).toBe(true);
  });
});
