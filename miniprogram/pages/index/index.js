const { api, tokenKey } = require('../../utils/api');
Page({
  data: {
    authenticated: false,
    busy: false,
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
  },
  async onLoad(query) {
    this.setData({
      projectId: query.projectId || '',
      taskId: query.taskId || '',
    });
    if (wx.getStorageSync(tokenKey)) await this.run(() => this.loadProjects());
  },
  async run(action) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await action();
    } catch (error) {
      if (error.status === 401)
        this.setData({
          authenticated: false,
          task: null,
          items: [],
          activity: [],
        });
      this.setData({ error: error.message || '操作失败，请重试' });
    } finally {
      this.setData({ busy: false });
    }
  },
  async login() {
    await this.run(async () => {
      const code = await new Promise((resolve, reject) =>
        wx.login({
          success: (r) =>
            r.code ? resolve(r.code) : reject(new Error('微信登录未成功')),
          fail: () => reject(new Error('微信登录未成功')),
        }),
      );
      const result = await api('auth', 'POST', { action: 'login', code });
      if (result.status === 'unlinked') {
        wx.removeStorageSync(tokenKey);
        this.setData({
          authenticated: false,
          pairingCode: result.pairingCode,
          pairingUntil: new Date(result.expiresAt).toLocaleTimeString(),
        });
        return;
      }
      wx.setStorageSync(tokenKey, result.token);
      this.setData({ pairingCode: '', pairingUntil: '' });
      await this.loadProjects();
    });
  },
  async loadProjects() {
    const result = await api('tasks');
    this.setData({
      authenticated: true,
      user: result.user,
      projects: result.projects,
    });
    if (!result.projects.length) {
      this.setData({ projectId: '', items: [], task: null });
      return;
    }
    let index = result.projects.findIndex((p) => p.id === this.data.projectId);
    if (index < 0 && this.data.projectId)
      throw new Error('你没有通知所指项目的访问权限');
    if (index < 0) index = 0;
    this.setData({ projectIndex: index, projectId: result.projects[index].id });
    await this.loadContent();
  },
  async loadContent() {
    if (!this.data.projectId) return;
    let path = `tasks?projectId=${encodeURIComponent(this.data.projectId)}`;
    if (this.data.taskId) {
      path += `&taskId=${encodeURIComponent(this.data.taskId)}`;
      const result = await api(path);
      this.setData({
        task: result.task,
        activity: result.activity.items,
        nextCursor: result.activity.nextCursor,
      });
    } else {
      const result = await api(path);
      this.setData({
        task: null,
        items: result.items.map((item, index) => ({
          ...item,
          key: `${item.type}-${item.taskId}-${index}`,
        })),
      });
    }
  },
  async switchProject(event) {
    if (this.data.busy) return;
    const index = Number(event.detail.value);
    this.setData({
      projectIndex: index,
      projectId: this.data.projects[index].id,
      taskId: '',
      comment: '',
    });
    await this.run(() => this.loadContent());
  },
  async openTask(event) {
    if (this.data.busy) return;
    this.setData({ taskId: event.currentTarget.dataset.id, comment: '' });
    await this.run(() => this.loadContent());
  },
  async back() {
    if (this.data.busy) return;
    this.setData({ taskId: '', task: null, comment: '' });
    await this.run(() => this.loadContent());
  },
  async refresh() {
    await this.run(() => this.loadProjects());
  },
  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },
  inputComment(event) {
    this.setData({ comment: event.detail.value });
  },
  async comment() {
    await this.run(async () => {
      if (!this.data.comment.trim()) throw new Error('请先填写评论');
      await api('tasks', 'POST', {
        action: 'comment',
        projectId: this.data.projectId,
        taskId: this.data.task.id,
        body: this.data.comment,
      });
      this.setData({ comment: '' });
      await this.loadContent();
    });
  },
  async check(event) {
    await this.run(async () => {
      const item = this.data.task.acceptanceCriteria.find(
        (i) => i.id === event.currentTarget.dataset.id,
      );
      await api('tasks', 'POST', {
        action: 'check',
        projectId: this.data.projectId,
        taskId: this.data.task.id,
        updatedAt: this.data.task.updatedAt,
        id: item.id,
        itemUpdatedAt: item.updatedAt,
        completed: !item.completed,
      });
      await this.loadContent();
    });
  },
  async accept() {
    await this.run(async () => {
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
      await api('tasks', 'POST', {
        action: 'accept',
        projectId: this.data.projectId,
        taskId: this.data.task.id,
        updatedAt: this.data.task.updatedAt,
      });
      await this.loadContent();
    });
  },
  async more() {
    await this.run(async () => {
      if (!this.data.nextCursor) return;
      const result = await api(
        `tasks?projectId=${encodeURIComponent(this.data.projectId)}&taskId=${encodeURIComponent(this.data.task.id)}&cursor=${encodeURIComponent(this.data.nextCursor)}`,
      );
      this.setData({
        activity: [...this.data.activity, ...result.activity.items],
        nextCursor: result.activity.nextCursor,
      });
    });
  },
  copyPair() {
    wx.setClipboardData({ data: this.data.pairingCode });
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
    await this.run(async () => {
      await api('auth', 'POST', { action: 'logout' });
      wx.removeStorageSync(tokenKey);
      this.setData({
        authenticated: false,
        user: null,
        projects: [],
        items: [],
        task: null,
        activity: [],
        comment: '',
        pairingCode: '',
      });
    });
  },
});
