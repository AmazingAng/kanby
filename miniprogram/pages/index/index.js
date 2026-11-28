const { api, tokenKey } = require('../../utils/api');
function taskRef(task) {
  return task?.ref || (task?.number != null ? `KANBY-${task.number}` : '');
}
function taskView(task) {
  const criteria = task.acceptanceCriteria || [];
  return {
    ...task,
    ref: taskRef(task),
    completedCount: criteria.filter((item) => item.completed).length,
    totalCount: criteria.length,
    hasLongNote: (task.note || '').length > 220,
    stateLabel:
      task.status === 'shipped'
        ? '已完成'
        : task.turn?.reasonLabel ||
          (task.status === 'building' ? '开发中' : '想法'),
  };
}
function activityView(item) {
  const body = typeof item.body === 'string' ? item.body : '';
  const date = new Date(item.createdAt);
  const pad = (value) => String(value).padStart(2, '0');
  return {
    ...item,
    body,
    expanded: false,
    isLong: body.length > 180,
    initial: (item.actorName || 'K').slice(0, 1),
    timeLabel:
      item.createdAt && Number.isFinite(date.getTime())
        ? `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
        : '',
  };
}
function boardColumns(tasks = []) {
  return [
    ['ideas', '想法'],
    ['building', '开发中'],
    ['shipped', '已完成'],
  ].map(([id, label]) => {
    const columnTasks = tasks.filter((task) => task.status === id);
    return { id, label, count: columnTasks.length, tasks: columnTasks };
  });
}
Page({
  data: {
    authenticated: false,
    busy: false,
    writing: false,
    loaded: false,
    detailReady: false,
    selectedPreview: null,
    viewMode: 'queue',
    boardColumns: boardColumns(),
    boardTasks: [],
    error: '',
    projects: [],
    projectIndex: 0,
    projectId: '',
    taskId: '',
    items: [],
    task: null,
    activity: [],
    nextCursor: null,
    comment: '',
    pairingCode: '',
    pairingUntil: '',
    user: null,
    userInitial: '',
    descriptionExpanded: false,
  },
  async onLoad(query) {
    this.setData({
      projectId: query.projectId || '',
      taskId: query.taskId || '',
    });
    if (wx.getStorageSync(tokenKey)) await this.run(() => this.loadProjects());
  },
  // Each navigation invalidates the previous read, including its catch/finally.
  requestContext() {
    return {
      generation: this._generation || 0,
      token: wx.getStorageSync(tokenKey),
      projectId: this.data.projectId,
      taskId: this.data.taskId,
      viewMode: this.data.viewMode,
    };
  },
  isCurrent(context, scoped = true) {
    return (
      context.generation === (this._generation || 0) &&
      context.token === wx.getStorageSync(tokenKey) &&
      (!scoped ||
        (context.projectId === this.data.projectId &&
          context.taskId === this.data.taskId &&
          context.viewMode === this.data.viewMode))
    );
  },
  cancelRead() {
    if (this.data.writing) return false;
    this._generation = (this._generation || 0) + 1;
    this.setData({ busy: false, error: '', detailReady: false });
    return true;
  },
  clearDetail() {
    this.setData({
      task: null,
      activity: [],
      nextCursor: null,
      detailReady: false,
      selectedPreview: null,
      loaded: false,
      descriptionExpanded: false,
    });
  },
  clearContent() {
    this._detailCache = new Map();
    this._cacheToken = wx.getStorageSync(tokenKey);
    this.clearDetail();
    this.setData({ items: [], boardTasks: [], boardColumns: boardColumns() });
  },
  detailCache() {
    if (!this._detailCache) {
      this._detailCache = new Map();
      this._cacheToken = wx.getStorageSync(tokenKey);
    } else if (this._cacheToken !== wx.getStorageSync(tokenKey)) {
      this.clearContent();
    }
    return this._detailCache;
  },
  cacheKey(projectId, taskId) {
    return JSON.stringify([projectId, taskId]);
  },
  matchesTask(task, context = this.data) {
    return (
      task &&
      (task.id === context.taskId || taskRef(task) === context.taskId) &&
      (!task.projectId || task.projectId === context.projectId)
    );
  },
  async run(action, writing = false) {
    if (this.data.busy || this.data.writing) return;
    this._generation = (this._generation || 0) + 1;
    const context = this.requestContext();
    this.setData({ busy: true, writing, error: '' });
    try {
      await action(context);
    } catch (error) {
      const sessionExpired =
        error.status === 401 && !wx.getStorageSync(tokenKey);
      if (
        context.generation !== this._generation ||
        (!sessionExpired && !this.isCurrent(context, false))
      )
        return;
      if ([401, 403, 404].includes(error.status)) this.clearContent();
      if (error.status === 401)
        this.setData({
          authenticated: false,
          user: null,
          userInitial: '',
          projects: [],
        });
      this.setData({
        detailReady: false,
        error: error.message || '操作失败，请重试',
      });
    } finally {
      // Transport may remove the token on 401; generation still owns the spinner.
      if (context.generation === this._generation)
        this.setData({ busy: false, writing: false });
    }
  },
  async login() {
    await this.run(async (context) => {
      const code = await new Promise((resolve, reject) =>
        wx.login({
          success: (r) =>
            r.code ? resolve(r.code) : reject(new Error('微信登录未成功')),
          fail: () => reject(new Error('微信登录未成功')),
        }),
      );
      if (!this.isCurrent(context, false)) return;
      const result = await api('auth', 'POST', { action: 'login', code });
      if (!this.isCurrent(context, false)) return;
      this.clearContent();
      if (result.status === 'unlinked') {
        wx.removeStorageSync(tokenKey);
        context.token = '';
        this.setData({
          authenticated: false,
          user: null,
          userInitial: '',
          projects: [],
          pairingCode: result.pairingCode,
          pairingUntil: new Date(result.expiresAt).toLocaleTimeString(),
        });
        return;
      }
      wx.setStorageSync(tokenKey, result.token);
      context.token = result.token;
      this.clearContent();
      this.setData({ pairingCode: '', pairingUntil: '' });
      await this.loadProjects();
    });
  },
  async loadProjects() {
    const context = this.requestContext();
    const result = await api('tasks');
    if (!this.isCurrent(context)) return;
    if (this.data.user && this.data.user.id !== result.user?.id)
      this.clearContent();
    this.setData({
      authenticated: true,
      user: result.user,
      userInitial: (result.user?.name || 'K').slice(0, 1),
      projects: result.projects,
    });
    if (!result.projects.length) {
      this.clearContent();
      this.setData({ projectId: '', taskId: '', loaded: true });
      return;
    }
    let index = result.projects.findIndex((p) => p.id === context.projectId);
    if (index < 0 && context.projectId) {
      this.clearContent();
      throw new Error('你没有通知所指项目的访问权限');
    }
    if (index < 0) index = 0;
    this.setData({ projectIndex: index, projectId: result.projects[index].id });
    await this.loadContent();
  },
  async loadContent() {
    if (!this.data.projectId) return;
    const context = this.requestContext();
    const cache = this.detailCache();
    this.setData({ loaded: false, detailReady: false });
    let path = `tasks?projectId=${encodeURIComponent(context.projectId)}`;
    if (context.taskId) {
      const key = this.cacheKey(context.projectId, context.taskId);
      const cached = cache.get(key);
      if (cached && this.matchesTask(cached.task, context))
        this.setData(cached);
      path += `&taskId=${encodeURIComponent(context.taskId)}`;
      const result = await api(path);
      if (!this.isCurrent(context)) return;
      if (!this.matchesTask(result.task, context)) {
        this.clearContent();
        throw new Error('任务详情与所选卡片不匹配，请重试');
      }
      const content = {
        task: taskView(result.task),
        activity: result.activity.items.map(activityView),
        nextCursor: result.activity.nextCursor,
      };
      cache.delete(key);
      cache.set(key, content);
      while (cache.size > 20) cache.delete(cache.keys().next().value);
      this.setData({
        ...content,
        selectedPreview: null,
        detailReady: true,
        loaded: true,
      });
    } else if (context.viewMode === 'board') {
      const result = await api(`${path}&view=board`);
      if (!this.isCurrent(context)) return;
      const tasks = result.tasks
        .filter(
          (task) =>
            ['ideas', 'building', 'shipped'].includes(task.status) &&
            !task.archivedAt &&
            (!task.projectId || task.projectId === context.projectId),
        )
        .map(taskView);
      this.setData({
        boardTasks: tasks,
        boardColumns: boardColumns(tasks),
        loaded: true,
      });
    } else {
      const result = await api(path);
      if (!this.isCurrent(context)) return;
      this.setData({
        loaded: true,
        items: result.items.map((item, index) => ({
          ...item,
          key: `${item.type}-${item.taskId}-${index}`,
          displayReason:
            item.type === 'mention'
              ? '提到了你'
              : item.turn?.reasonLabel || '轮到你',
          displayNote: item.mention?.body || item.turn?.note || '',
          needsAcceptance: item.turn?.reason === 'awaiting_acceptance',
        })),
      });
    }
  },
  async switchView(event) {
    const viewMode = event.currentTarget.dataset.view;
    if (!['queue', 'board'].includes(viewMode) || !this.cancelRead()) return;
    this.clearDetail();
    this.setData({ viewMode, taskId: '', comment: '' });
    await this.run(() => this.loadContent());
  },
  async switchProject(event) {
    const index = Number(event.detail.value);
    const project = this.data.projects[index];
    if (!project || !this.cancelRead()) return;
    this.clearContent();
    this.setData({
      projectIndex: index,
      projectId: project.id,
      taskId: '',
      comment: '',
    });
    await this.run(() => this.loadContent());
  },
  async openTask(event) {
    const taskId = event.currentTarget.dataset.id;
    if (!taskId || !this.cancelRead()) return;
    // Initialize the cache before reading the list, so cache setup cannot erase preview.
    this.detailCache();
    const known = [...this.data.items, ...this.data.boardTasks].find(
      (task) =>
        task.taskId === taskId ||
        task.id === taskId ||
        taskRef(task) === taskId,
    );
    this.clearDetail();
    this.setData({
      taskId,
      comment: '',
      selectedPreview: {
        title: known?.title || '加载任务中',
        ref: taskRef(known),
      },
    });
    await this.run(() => this.loadContent());
  },
  async back() {
    if (!this.cancelRead()) return;
    this.clearDetail();
    this.setData({ taskId: '', comment: '' });
    await this.run(() => this.loadContent());
  },
  async refresh() {
    await this.run(() =>
      this.data.projects.length && this.data.projectId
        ? this.loadContent()
        : this.loadProjects(),
    );
  },
  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },
  inputComment(event) {
    this.setData({ comment: event.detail.value });
  },
  canWrite() {
    this.detailCache();
    return (
      this.data.detailReady &&
      this.matchesTask(this.data.task) &&
      !this.data.busy &&
      !this.data.writing
    );
  },
  async comment() {
    if (!this.canWrite()) return;
    await this.run(async (context) => {
      if (!this.data.comment.trim()) throw new Error('请先填写评论');
      await api('tasks', 'POST', {
        action: 'comment',
        projectId: context.projectId,
        taskId: this.data.task.id,
        body: this.data.comment,
      });
      if (!this.isCurrent(context)) return;
      this.setData({ comment: '' });
      await this.loadContent();
    }, true);
  },
  async check(event) {
    if (!this.canWrite()) return;
    const task = this.data.task;
    const item = task.acceptanceCriteria.find(
      (i) => i.id === event.currentTarget.dataset.id,
    );
    if (!item) return;
    await this.run(async (context) => {
      await api('tasks', 'POST', {
        action: 'check',
        projectId: context.projectId,
        taskId: task.id,
        updatedAt: task.updatedAt,
        id: item.id,
        itemUpdatedAt: item.updatedAt,
        completed: !item.completed,
      });
      if (this.isCurrent(context)) await this.loadContent();
    }, true);
  },
  async accept() {
    if (!this.canWrite()) return;
    const task = this.data.task;
    await this.run(async (context) => {
      const confirmed = await new Promise((resolve) =>
        wx.showModal({
          title: '确认验收完成？',
          content: '这会将卡片标记为已完成。请确认全部验收项已检查。',
          confirmText: '验收完成',
          success: (r) => resolve(r.confirm),
          fail: () => resolve(false),
        }),
      );
      if (!confirmed) return;
      if (!this.isCurrent(context) || !this.matchesTask(task)) return;
      await api('tasks', 'POST', {
        action: 'accept',
        projectId: context.projectId,
        taskId: task.id,
        updatedAt: task.updatedAt,
      });
      if (this.isCurrent(context)) await this.loadContent();
    }, true);
  },
  async more() {
    if (
      !this.data.detailReady ||
      !this.matchesTask(this.data.task) ||
      !this.data.nextCursor
    )
      return;
    await this.run(async (context) => {
      const result = await api(
        `tasks?projectId=${encodeURIComponent(context.projectId)}&taskId=${encodeURIComponent(this.data.task.id)}&cursor=${encodeURIComponent(this.data.nextCursor)}`,
      );
      if (!this.isCurrent(context)) return;
      this.setData({
        activity: [
          ...this.data.activity,
          ...result.activity.items.map(activityView),
        ],
        nextCursor: result.activity.nextCursor,
      });
    });
  },
  copyPair() {
    wx.setClipboardData({ data: this.data.pairingCode });
  },
  toggleDescription() {
    this.setData({ descriptionExpanded: !this.data.descriptionExpanded });
  },
  toggleActivity(event) {
    this.setData({
      activity: this.data.activity.map((item) =>
        item.id === event.currentTarget.dataset.id
          ? { ...item, expanded: !item.expanded }
          : item,
      ),
    });
  },
  accountMenu() {
    if (this.data.writing) return;
    wx.showActionSheet({
      itemList: ['退出登录'],
      success: (result) => {
        if (result.tapIndex === 0) void this.logout();
      },
    });
  },
  copyLink() {
    const { origin } = require('../../config');
    wx.setClipboardData({ data: `${origin}/mini` });
  },
  copyResource(event) {
    const { origin } = require('../../config');
    const url = event.currentTarget.dataset.url;
    wx.setClipboardData({
      data: url.startsWith('/') ? `${origin}${url}` : url,
    });
  },
  async logout() {
    if (!this.cancelRead()) return;
    this.clearContent();
    this.setData({
      authenticated: false,
      user: null,
      userInitial: '',
      projects: [],
      projectId: '',
      taskId: '',
      comment: '',
      pairingCode: '',
      pairingUntil: '',
    });
    await this.run(async (context) => {
      await api('auth', 'POST', { action: 'logout' });
      if (!this.isCurrent(context, false)) return;
      wx.removeStorageSync(tokenKey);
      context.token = '';
      this.clearContent();
    }, true);
  },
});
