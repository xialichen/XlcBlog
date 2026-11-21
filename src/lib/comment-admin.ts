import { action, commentCard, el, errorMessage, requestJson, type CommentRow, type Page } from './comment-view';

interface AdminRow extends CommentRow { article: string; title: string; reports: number; }
interface Report { reason: string; detail: string; }
const reasons: Record<string, string> = {
  spam: '广告刷屏', abuse: '攻击或隐私问题', removal: '申请移除自己的留言', other: '其他',
};
const api = '/admin/comments/api';

export function mountAdmin(root: HTMLElement) {
  const list = root.querySelector('ol')!, status = root.querySelector('[role=status]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')];
  let filter = 'tasks', next: string | null = null, version = 0;

  function card(row: AdminRow) {
    const item = commentCard(row);
    const link = el('a', row.title);
    link.href = '/writing/' + row.article.split('/').map(encodeURIComponent).join('/') + '/';
    item.prepend(link);
    const tools = el('div', '', 'comment-actions');
    const note = el('p'); note.setAttribute('role', 'status');
    const path = api + '/' + row.id + '/';
    async function change(operation: string, data = {}) {
      const buttons = [...item.querySelectorAll('button')];
      buttons.forEach(button => { button.disabled = true; });
      try {
        await requestJson(path + operation, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        await load();
      } catch (error) { note.textContent = errorMessage(error); }
      finally { buttons.forEach(button => { button.disabled = false; }); }
    }
    if (row.reports) {
      const details = el('div');
      let cursor: string | null = null;
      const feedback = action('查看反馈（' + row.reports + '）', async () => {
        feedback.disabled = true;
        try {
          const data = await requestJson<Page<Report>>(path + 'feedback' + (cursor ? '?before=' + encodeURIComponent(cursor) : ''));
          data.items.forEach(report => details.append(el('p', (reasons[report.reason] || '其他') + (report.detail ? ' · ' + report.detail : ''))));
          cursor = data.next;
          feedback.hidden = !cursor; feedback.textContent = '更多反馈';
        } catch (error) { note.textContent = errorMessage(error); }
        finally { feedback.disabled = false; }
      });
      tools.append(feedback, action('标记反馈已处理', () => { void change('resolve'); }));
      item.append(details);
    }
    if (row.state === 'pending') tools.append(action('同意公开', () => { void change('publish'); }));
    if (row.state === 'hidden') tools.append(action('恢复留言', () => { void change('restore'); }));
    else tools.append(action('隐藏留言', () => { void change('hide'); }));
    if (row.state === 'published') {
      const form = el('form', '', 'comment-form');
      form.hidden = true;
      const label = el('label', '站主回复'), body = el('textarea');
      body.value = row.reply || ''; body.required = true; body.maxLength = 2000; label.append(body);
      const submit = el('button', '保存回复', 'comment-primary'); submit.type = 'submit';
      form.append(label, submit);
      form.addEventListener('submit', e => { e.preventDefault(); void change('reply', { body: body.value }); });
      tools.append(action(row.reply ? '编辑回复' : '回复', () => { form.hidden = !form.hidden; if (!form.hidden) body.focus(); }));
      item.append(form);
    }
    item.append(tools, note);
    return item;
  }
  async function load(append = false) {
    const active = ++version;
    more.disabled = true;
    try {
      const params = new URLSearchParams({ filter });
      if (append && next) params.set('before', next);
      const data = await requestJson<Page<AdminRow>>(api + '?' + params);
      if (active !== version) return;
      if (!append) list.replaceChildren();
      list.append(...data.items.map(card));
      next = data.next; more.hidden = !next; more.textContent = '加载更多';
      status.textContent = list.children.length ? '' : '目前没有这类留言。';
    } catch (error) {
      if (active !== version) return;
      status.textContent = errorMessage(error); more.hidden = false; more.textContent = '重试';
    } finally { if (active === version) more.disabled = false; }
  }
  tabs.forEach(tab => tab.addEventListener('click', () => {
    filter = tab.dataset.filter!; next = null;
    list.replaceChildren();
    tabs.forEach(button => button.setAttribute('aria-pressed', String(tab === button)));
    void load();
  }));
  more.addEventListener('click', () => { void load(!!next); });
  void load();
}
