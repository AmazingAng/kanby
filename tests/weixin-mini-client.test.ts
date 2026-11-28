import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
type ClientTask = {
  id: string;
  projectId?: string;
  ref?: string;
  number?: number;
  title?: string;
  status?: string;
  updatedAt?: number;
  acceptanceCriteria?: Array<{
    id: string;
    completed: boolean;
    updatedAt?: number;
  }>;
};
type CardEvent = { currentTarget: { dataset: { id?: string; view?: string } } };
type Modal = { success(this: void, result: { confirm: boolean }): void };
function page(api: ReturnType<typeof vi.fn>, token = 'token') {
  type Data = {
    authenticated: boolean;
    projectId: string;
    task: ClientTask | null;
    taskId: string;
    projects: Array<{ id: string; name: string }>;
    user: { name: string } | null;
    viewMode: 'queue' | 'board';
    boardColumnIndex: number;
    boardColumns: Array<{
      id: string;
      label: string;
      count: number;
      tasks: ClientTask[];
    }>;
    boardTasks: ClientTask[];
    items: Array<{ taskId: string; title: string; ref: string }>;
    activity: Array<{ id: string; body?: string }>;
    nextCursor: string | null;
    selectedPreview: { title: string; ref: string } | null;
    detailReady: boolean;
    writing: boolean;
    loaded: boolean;
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
    check(event: CardEvent): Promise<void>;
    switchView(event: CardEvent): Promise<void>;
    selectBoardColumn(event: {
      currentTarget: { dataset: { index: number } };
    }): void;
    onBoardSwipe(event: { detail: { current: number; source: string } }): void;
    switchProject(event: { detail: { value: string } }): Promise<void>;
    openTask(event: CardEvent): Promise<void>;
    back(): Promise<void>;
    refresh(): Promise<void>;
    more(): Promise<void>;
    logout(): Promise<void>;
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
      taskId: 't',
      detailReady: true,
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
      taskId: 't',
      detailReady: true,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const card = (id: string): CardEvent => ({
  currentTarget: { dataset: { id } },
});
const board = { currentTarget: { dataset: { view: 'board' } } };
const queue = { currentTarget: { dataset: { view: 'queue' } } };
function detail(id = 't', title = 'Fresh card') {
  return {
    task: {
      id,
      projectId: 'p',
      ref: 'KANBY-1',
      title,
      status: 'building',
      updatedAt: 123,
      acceptanceCriteria: [{ id: 'check', completed: false, updatedAt: 1 }],
    },
    activity: {
      items: [{ id: 'event', body: 'Fresh activity' }],
      nextCursor: 'next',
    },
  };
}
function readyPage(api: ReturnType<typeof vi.fn>) {
  const result = page(api);
  result.instance.setData({
    authenticated: true,
    projectId: 'p',
    projects: [
      { id: 'p', name: 'Project' },
      { id: 'q', name: 'Other' },
    ],
    items: [{ taskId: 't', title: 'Known card', ref: 'KANBY-1' }],
  });
  return result;
}

describe('mini board and fresh detail navigation', () => {
  it('preloads the board, shares an in-flight request, and switches instantly once both lists are fresh', async () => {
    const pending = deferred<{ tasks: ClientTask[] }>();
    const api = vi
      .fn()
      .mockResolvedValueOnce({
        projects: [{ id: 'p', name: 'Project' }],
        user: { name: 'Alice Full Nickname' },
      })
      .mockResolvedValueOnce({ items: [] })
      .mockReturnValueOnce(pending.promise);
    const { instance } = page(api);
    await instance.onLoad({ projectId: 'p', taskId: '' });
    expect(api).toHaveBeenLastCalledWith('tasks?projectId=p&view=board');
    expect(instance.data.viewMode).toBe('queue');
    expect(instance.data.loaded).toBe(true);
    expect(instance.data.busy).toBe(false);
    const request = instance.switchView(board);
    expect(instance.data.viewMode).toBe('board');
    expect(instance.data.loaded).toBe(false);
    expect(instance.data.busy).toBe(true);
    pending.resolve({
      tasks: [
        detail().task,
        { id: 'idea', status: 'ideas' },
        { id: 'done', status: 'shipped' },
      ],
    });
    await request;
    expect(api).toHaveBeenCalledTimes(3);
    expect(
      instance.data.boardColumns.map(({ id, count }) => ({ id, count })),
    ).toEqual([
      { id: 'ideas', count: 1 },
      { id: 'building', count: 1 },
      { id: 'shipped', count: 1 },
    ]);
    expect(instance.data.boardColumns[1]?.tasks[0]).toMatchObject({
      id: 't',
      completedCount: 0,
      totalCount: 1,
    });
    expect(instance.data.boardTasks).toHaveLength(3);
    expect(instance.data.user?.name).toBe('Alice Full Nickname');
    expect(instance.data.loaded).toBe(true);
    const toQueue = instance.switchView(queue);
    expect(instance.data.loaded).toBe(true);
    await toQueue;
    const toBoard = instance.switchView(board);
    expect(instance.data.loaded).toBe(true);
    expect(instance.data.busy).toBe(false);
    await toBoard;
    expect(api).toHaveBeenCalledTimes(3);

    api.mockResolvedValueOnce({ tasks: [] });
    await instance.refresh();
    expect(api).toHaveBeenCalledTimes(4);
    expect(instance.data.boardTasks).toEqual([]);
  });

  it('clears a warm queue when the background board request loses project access', async () => {
    const prefetch = deferred<{ tasks: ClientTask[] }>();
    const api = vi
      .fn()
      .mockResolvedValueOnce({ projects: [{ id: 'p', name: 'Project' }] })
      .mockResolvedValueOnce({
        items: [{ taskId: 't', title: 'Private card' }],
      })
      .mockReturnValueOnce(prefetch.promise);
    const { instance } = page(api);
    await instance.onLoad({ projectId: 'p', taskId: '' });
    expect(instance.data.items).toHaveLength(1);
    prefetch.reject(
      Object.assign(new Error('项目访问权限已变更'), { status: 403 }),
    );
    await vi.waitFor(() =>
      expect(instance.data.error).toBe('项目访问权限已变更'),
    );
    expect(instance.data.items).toEqual([]);
    expect(instance.data.loaded).toBe(false);
  });

  it('keeps the chosen board column through card navigation and resets it for a new project', async () => {
    const boardResult = { tasks: [detail().task] };
    const api = vi
      .fn()
      .mockResolvedValue(boardResult)
      .mockResolvedValueOnce(boardResult)
      .mockResolvedValueOnce(detail());
    const { instance } = readyPage(api);
    await instance.switchView(board);
    instance.onBoardSwipe({ detail: { current: 1, source: 'touch' } });
    expect(instance.data.boardColumnIndex).toBe(1);
    instance.selectBoardColumn({ currentTarget: { dataset: { index: 2 } } });
    instance.onBoardSwipe({ detail: { current: 1, source: '' } });
    expect(instance.data.boardColumnIndex).toBe(2);
    expect(api).toHaveBeenCalledTimes(1);

    instance.onBoardSwipe({ detail: { current: 1, source: 'touch' } });
    await instance.openTask(card('t'));
    await instance.back();
    expect(instance.data.boardColumnIndex).toBe(1);
    await instance.switchProject({ detail: { value: '1' } });
    expect(instance.data.boardColumnIndex).toBe(0);
  });

  it('opens a KANBY number deep link and writes using the resolved task ID', async () => {
    const result = detail();
    const { ref: _ref, ...task } = result.task;
    const numbered = { ...result, task: { ...task, number: 145 } };
    const api = vi
      .fn()
      .mockResolvedValueOnce(numbered)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(numbered);
    const { instance } = readyPage(api);
    await instance.openTask(card('KANBY-145'));
    expect(instance.data.task?.id).toBe('t');
    expect(instance.data.detailReady).toBe(true);
    instance.setData({ comment: 'number link' });
    await instance.comment();
    expect(api).toHaveBeenCalledWith('tasks', 'POST', {
      action: 'comment',
      projectId: 'p',
      taskId: 't',
      body: 'number link',
    });
  });

  it('derives the board preview reference from the task number before detail arrives', async () => {
    const pending = deferred<ReturnType<typeof detail>>();
    const api = vi.fn().mockReturnValueOnce(pending.promise);
    const { instance } = readyPage(api);
    instance.setData({
      viewMode: 'board',
      items: [],
      boardTasks: [
        { id: 't', number: 145, title: 'Numbered card', status: 'building' },
      ],
    });
    const opening = instance.openTask(card('t'));
    expect(instance.data.selectedPreview).toEqual({
      title: 'Numbered card',
      ref: 'KANBY-145',
    });
    pending.resolve(detail());
    await opening;
  });

  it('shows immediate preview, revalidates warm detail, and permits writes only after fresh detail', async () => {
    const first = deferred<ReturnType<typeof detail>>();
    const fresh = deferred<ReturnType<typeof detail>>();
    const api = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        items: [{ taskId: 't', title: 'Known card', ref: 'KANBY-1' }],
      })
      .mockReturnValueOnce(fresh.promise)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(detail());
    const { instance, wx } = readyPage(api);
    const opening = instance.openTask(card('t'));
    expect(instance.data.selectedPreview).toEqual({
      title: 'Known card',
      ref: 'KANBY-1',
    });
    expect(instance.data.task).toBeNull();
    expect(instance.data.detailReady).toBe(false);
    first.resolve(detail('t', 'Cached card'));
    await opening;
    expect(instance.data.detailReady).toBe(true);
    await instance.back();
    const reopening = instance.openTask(card('t'));
    expect(instance.data.task?.title).toBe('Cached card');
    expect(instance.data.detailReady).toBe(false);
    instance.setData({ comment: 'new comment' });
    await instance.comment();
    await instance.check(card('check'));
    await instance.accept();
    expect(api.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(0);
    expect(wx.showModal).not.toHaveBeenCalled();
    fresh.resolve(detail());
    await reopening;
    await instance.comment();
    expect(api).toHaveBeenCalledWith('tasks', 'POST', {
      action: 'comment',
      projectId: 'p',
      taskId: 't',
      body: 'new comment',
    });
  });

  it('allows back during reads, retains board, and ignores a late detail result', async () => {
    const pending = deferred<ReturnType<typeof detail>>();
    const list = deferred<{ tasks: ClientTask[] }>();
    const api = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(list.promise);
    const { instance } = readyPage(api);
    instance.setData({ viewMode: 'board', boardTasks: [detail().task] });
    const opening = instance.openTask(card('t'));
    const back = instance.back();
    expect(instance.data.taskId).toBe('');
    expect(instance.data.viewMode).toBe('board');
    pending.resolve(detail());
    await opening;
    expect(instance.data.task).toBeNull();
    expect(instance.data.busy).toBe(true);
    list.resolve({ tasks: [] });
    await back;
    expect(instance.data.busy).toBe(false);
    expect(instance.data.detailReady).toBe(false);
  });

  it.each([401, 403, 404])(
    'clears warm cache and content on %s and retries without cached detail',
    async (status) => {
      const failure = deferred<ReturnType<typeof detail>>();
      const retry = deferred<ReturnType<typeof detail>>();
      const api = vi
        .fn()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce({ items: [] })
        .mockReturnValueOnce(failure.promise)
        .mockReturnValueOnce(retry.promise);
      const { instance } = readyPage(api);
      await instance.openTask(card('t'));
      await instance.back();
      const opening = instance.openTask(card('t'));
      expect(instance.data.task?.title).toBe('Fresh card');
      failure.reject(Object.assign(new Error('denied'), { status }));
      await opening;
      expect(instance.data.task).toBeNull();
      expect(instance.data.activity).toEqual([]);
      expect(instance.data.boardTasks).toEqual([]);
      expect(instance.data.items).toEqual([]);
      expect(instance.data.selectedPreview).toBeNull();
      expect(instance.data.detailReady).toBe(false);
      expect(instance.data.error).toBe('denied');
      if (status === 401) expect(instance.data.authenticated).toBe(false);
      instance.setData({ projectId: 'p', authenticated: true });
      const again = instance.openTask(card('t'));
      expect(instance.data.task).toBeNull();
      retry.resolve(detail());
      await again;
      expect(instance.data.detailReady).toBe(true);
    },
  );

  it('retries failed detail directly without fetching projects and gates stale writes', async () => {
    const retry = deferred<ReturnType<typeof detail>>();
    const api = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(retry.promise);
    const { instance } = readyPage(api);
    await instance.openTask(card('t'));
    expect(instance.data.detailReady).toBe(false);
    expect(instance.data.error).toBe('offline');
    instance.setData({ comment: 'retry later' });
    await instance.comment();
    await instance.accept();
    await instance.check(card('check'));
    expect(api).toHaveBeenCalledTimes(1);
    const refresh = instance.refresh();
    expect(api).toHaveBeenLastCalledWith('tasks?projectId=p&taskId=t');
    retry.resolve(detail());
    await refresh;
    expect(instance.data.error).toBe('');
    expect(instance.data.detailReady).toBe(true);
  });

  it('blocks mismatched displayed task writes even if detailReady was set', async () => {
    const api = vi.fn();
    const { instance, wx } = readyPage(api);
    instance.setData({
      taskId: 'selected',
      task: detail().task,
      detailReady: true,
      comment: 'wrong task',
    });
    await instance.comment();
    await instance.check(card('check'));
    await instance.accept();
    expect(api).not.toHaveBeenCalled();
    expect(wx.showModal).not.toHaveBeenCalled();
  });

  it('does not let back cancel an active write or submit a duplicate', async () => {
    const write = deferred<object>();
    const api = vi
      .fn()
      .mockResolvedValueOnce(detail())
      .mockReturnValueOnce(write.promise)
      .mockResolvedValueOnce(detail());
    const { instance } = readyPage(api);
    await instance.openTask(card('t'));
    instance.setData({ comment: 'save' });
    const saving = instance.comment();
    expect(instance.data.writing).toBe(true);
    await instance.back();
    await instance.comment();
    expect(instance.data.taskId).toBe('t');
    expect(api).toHaveBeenCalledTimes(2);
    write.resolve({});
    await saving;
    expect(instance.data.writing).toBe(false);
    expect(instance.data.detailReady).toBe(true);
  });

  it('discards late pagination and its errors after navigating to another task', async () => {
    const more = deferred<ReturnType<typeof detail>>();
    const fresh = deferred<ReturnType<typeof detail>>();
    const api = vi
      .fn()
      .mockResolvedValueOnce(detail())
      .mockReturnValueOnce(more.promise)
      .mockReturnValueOnce(fresh.promise);
    const { instance } = readyPage(api);
    await instance.openTask(card('t'));
    const paging = instance.more();
    const opening = instance.openTask(card('other'));
    more.reject(Object.assign(new Error('old denied'), { status: 403 }));
    await paging;
    expect(instance.data.taskId).toBe('other');
    expect(instance.data.error).toBe('');
    expect(instance.data.busy).toBe(true);
    fresh.resolve(detail('other'));
    await opening;
    expect(instance.data.activity).toHaveLength(1);
    expect(instance.data.task?.id).toBe('other');
  });

  it('clears cache on project changes and ignores old list responses', async () => {
    const oldList = deferred<{ tasks: ClientTask[] }>();
    const newList = deferred<{ tasks: ClientTask[] }>();
    const retry = deferred<ReturnType<typeof detail>>();
    const api = vi
      .fn(async (path: string) => {
        if (path === 'tasks?projectId=q&view=board') return newList.promise;
        if (path === 'tasks?projectId=p&view=board') return { tasks: [] };
        if (path.endsWith('&taskId=t')) return retry.promise;
        return { items: [] };
      })
      .mockResolvedValueOnce(detail())
      .mockReturnValueOnce(oldList.promise);
    const { instance } = readyPage(api);
    await instance.openTask(card('t'));
    const switching = instance.switchView(board);
    const project = instance.switchProject({ detail: { value: '1' } });
    expect(instance.data.projectId).toBe('q');
    expect(instance.data.task).toBeNull();
    oldList.resolve({ tasks: [detail().task] });
    await switching;
    expect(instance.data.boardTasks).toEqual([]);
    newList.resolve({
      tasks: [{ id: 'q-task', projectId: 'q', status: 'ideas' }],
    });
    await project;
    expect(instance.data.boardTasks.map((task) => task.id)).toEqual(['q-task']);
    await instance.switchProject({ detail: { value: '0' } });
    const opening = instance.openTask(card('t'));
    expect(instance.data.task).toBeNull();
    retry.resolve(detail());
    await opening;
  });

  it('clears sensitive content when the transport removes a rejected session token', async () => {
    const pending = deferred<ReturnType<typeof detail>>();
    const api = vi
      .fn()
      .mockResolvedValueOnce(detail())
      .mockResolvedValueOnce({ items: [] })
      .mockReturnValueOnce(pending.promise);
    const { instance, storage } = readyPage(api);
    await instance.openTask(card('t'));
    await instance.back();
    const reopening = instance.openTask(card('t'));
    expect(instance.data.task?.id).toBe('t');
    storage.token = '';
    pending.reject(
      Object.assign(new Error('expired session'), { status: 401 }),
    );
    await reopening;
    expect(instance.data.authenticated).toBe(false);
    expect(instance.data.task).toBeNull();
    expect(instance.data.activity).toEqual([]);
    expect(instance.data.error).toBe('expired session');
    expect(instance.data.busy).toBe(false);
  });

  it('clears cached detail and blocks writes after the account token changes', async () => {
    const api = vi.fn().mockResolvedValue(detail());
    const { instance, storage, wx } = readyPage(api);
    await instance.openTask(card('t'));
    storage.token = 'another-account';
    instance.setData({ comment: 'old account detail' });
    await instance.comment();
    await instance.check(card('check'));
    await instance.accept();
    expect(api).toHaveBeenCalledTimes(1);
    expect(wx.showModal).not.toHaveBeenCalled();
    expect(instance.data.task).toBeNull();
    expect(instance.data.detailReady).toBe(false);
  });

  it('evicts old detail after twenty entries while retaining recent warm detail', async () => {
    let pending: ReturnType<typeof deferred<ReturnType<typeof detail>>> | null =
      null;
    const api = vi.fn((path: string) =>
      pending
        ? pending.promise
        : Promise.resolve(
            detail(new URLSearchParams(path.split('?')[1]).get('taskId')!),
          ),
    );
    const { instance } = readyPage(api);
    for (let index = 0; index < 21; index++)
      await instance.openTask(card(`task-${index}`));
    pending = deferred<ReturnType<typeof detail>>();
    const evicted = instance.openTask(card('task-0'));
    expect(instance.data.task).toBeNull();
    pending.resolve(detail('task-0'));
    await evicted;
    pending = deferred<ReturnType<typeof detail>>();
    const warm = instance.openTask(card('task-20'));
    expect(instance.data.task?.id).toBe('task-20');
    expect(instance.data.detailReady).toBe(false);
    pending.resolve(detail('task-20'));
    await warm;
    expect(api).toHaveBeenCalledTimes(23);
  });

  it('invalidates project loading on logout before it can restore account content', async () => {
    const projects = deferred<object>();
    const logout = deferred<object>();
    const api = vi
      .fn()
      .mockReturnValueOnce(projects.promise)
      .mockReturnValueOnce(logout.promise);
    const { instance, storage } = page(api);
    const loading = instance.onLoad({ projectId: 'p', taskId: '' });
    const leaving = instance.logout();
    expect(instance.data.writing).toBe(true);
    projects.resolve({
      projects: [{ id: 'p', name: 'Project' }],
      user: { name: 'Old account' },
    });
    await loading;
    expect(instance.data.user).toBeNull();
    expect(instance.data.authenticated).toBe(false);
    expect(instance.data.busy).toBe(true);
    logout.resolve({});
    await leaving;
    expect(storage.token).toBe('');
    expect(api).toHaveBeenCalledTimes(2);
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
  it('does not erase a newer login when an old request returns 401', async () => {
    let token = 'old-session';
    let respond: (response: { statusCode: number; data: unknown }) => void;
    const remove = vi.fn(() => {
      token = '';
    });
    const commonJsModule = {
      exports: {} as { api: (path: string) => Promise<unknown> },
    };
    runInNewContext(readFileSync('miniprogram/utils/api.js', 'utf8'), {
      module: commonJsModule,
      require: () => ({ origin: 'https://kanby.test' }),
      wx: {
        getStorageSync: () => token,
        removeStorageSync: remove,
        request: (options: { success: typeof respond }) => {
          respond = options.success;
        },
      },
    });
    const pending = commonJsModule.exports.api('tasks');
    token = 'new-session';
    respond!({ statusCode: 401, data: { error: 'old session expired' } });
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(token).toBe('new-session');
    expect(remove).not.toHaveBeenCalled();
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
