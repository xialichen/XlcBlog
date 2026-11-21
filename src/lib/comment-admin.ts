import {
  action, commentCard, commentTime, confirmComment, el, errorMessage, feedbackReasons, notice, requestJson, showNotice,
  type CommentRow, type Page,
} from './comment-view';

interface AdminRow extends CommentRow { article: string; title: string; reports: number; }
interface Report { reason: string; detail: string; created_at: number; }
type Operation = 'publish' | 'hide' | 'restore' | 'resolve' | 'reply';
const api = '/admin/comments/api';

function feedbackDetails(row: AdminRow, resolve: () => void) {
  const details = el('details', '', 'comment-reports');
  const summary = el('summary', '待处理反馈 · ' + row.reports + ' 条');
  const entries = el('ul');
  const status = notice();
  const footer = el('div', '', 'comment-actions');
  const more = action('更多反馈', () => { void load(); });
  more.hidden = true;
  footer.append(more, action('标记全部反馈为已处理', resolve));
  details.append(summary, entries, status, footer);
  let cursor: string | null = null, loaded = false, loading = false;

  async function load() {
    if (loading) return;
    loading = true; more.disabled = true;
    showNotice(status, '正在加载反馈…');
    try {
      const params = cursor ? '?before=' + encodeURIComponent(cursor) : '';
      const data = await requestJson<Page<Report>>(api + '/' + row.id + '/feedback' + params);
      for (const report of data.items) {
        const entry = el('li'), meta = el('div', '', 'comment-meta');
        meta.append(el('strong', feedbackReasons[report.reason] || '其他原因'), commentTime(report.created_at));
        entry.append(meta);
        if (report.detail) entry.append(el('p', report.detail, 'comment-text'));
        entries.append(entry);
      }
      loaded = true; cursor = data.next; more.hidden = !cursor; more.textContent = '更多反馈';
      showNotice(status, entries.children.length ? '' : '目前没有待处理的反馈。');
    } catch (error) {
      showNotice(status, errorMessage(error), 'error');
      more.hidden = false; more.textContent = '重试加载反馈';
    } finally { more.disabled = false; loading = false; }
  }
  details.addEventListener('toggle', () => { if (details.open && !loaded) void load(); });
  return details;
}

export function mountAdmin(root: HTMLElement) {
  const list = root.querySelector('ol')!, status = root.querySelector<HTMLElement>('[data-list-status]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')];
  let filter = 'tasks', next: string | null = null, version = 0;

  function updateEmptyState() {
    const empty = filter === 'tasks' ? '目前没有待处理的留言或反馈。' : filter === 'published' ? '目前没有公开的留言。' : '目前没有隐藏的留言。';
    showNotice(status, list.querySelector('[data-comment-id]') || next ? '' : empty);
  }

  async function change(item: HTMLLIElement, id: string, operation: Operation, data = {}) {
    if (item.getAttribute('aria-busy') === 'true') return;
    item.setAttribute('aria-busy', 'true');
    const note = item.querySelector<HTMLElement>(':scope > .comment-notice')!;
    showNotice(note, '正在保存…');
    if (item.contains(document.activeElement)) note.focus({ preventScroll: true });
    const controls = item.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button:enabled, textarea:enabled');
    controls.forEach(control => { control.disabled = true; });
    try {
      const { item: updated } = await requestJson<{ item: AdminRow | null }>(api + '/' + id + '/' + operation, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      if (!item.isConnected) { await load(); return; }
      const messages = {
        publish: '留言已公开。', hide: '留言已隐藏。', resolve: '反馈已标记为已处理。', reply: '站主回复已保存。',
        restore: updated?.state === 'pending' ? '留言已恢复为待审核。' : '留言已恢复公开。',
      };
      const visible = updated && (filter === 'tasks' ? updated.state === 'pending' || updated.reports > 0 : updated.state === filter);
      const replacement = visible ? card(updated) : el('li', '', 'comment-receipt');
      const result = visible ? replacement.querySelector<HTMLElement>(':scope > .comment-notice')! : notice();
      if (!visible) replacement.append(result);
      if (operation === 'hide' && updated?.state === 'hidden') {
        replacement.append(action('撤销隐藏', () => { void change(replacement, id, 'restore'); }));
      }
      const focused = item.contains(document.activeElement);
      item.replaceWith(replacement);
      showNotice(result, updated ? messages[operation] : '这条留言已移除。', 'success');
      if (focused) result.focus({ preventScroll: true });
      updateEmptyState();
    } catch (error) {
      showNotice(note, errorMessage(error), 'error');
    } finally {
      item.removeAttribute('aria-busy');
      controls.forEach(control => { control.disabled = false; });
    }
  }

  function card(row: AdminRow) {
    const { item, header } = commentCard(row);
    const link = el('a', row.title, 'comment-source');
    link.href = '/writing/' + row.article.split('/').map(encodeURIComponent).join('/') + '/#comments-title';
    item.prepend(link);
    const tools = el('div', '', 'comment-actions comment-row-actions');
    header.append(tools);
    if (row.reports) item.append(feedbackDetails(row, () => { void change(item, row.id, 'resolve'); }));

    if (row.state === 'published') {
      const form = el('form', '', 'comment-form comment-editor');
      form.hidden = true; form.id = 'reply-' + row.id;
      const label = el('label', '站主回复', 'comment-field'), body = el('textarea');
      body.value = row.reply || ''; body.required = true; body.maxLength = 2000; body.rows = 3;
      label.append(body);
      const toggle = action(row.reply ? '编辑回复' : '回复', () => setOpen(form.hidden));
      toggle.setAttribute('aria-controls', form.id); toggle.setAttribute('aria-expanded', 'false');
      function setOpen(open: boolean) {
        form.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
        if (open) body.focus(); else toggle.focus();
      }
      const buttons = el('div', '', 'comment-actions');
      const save = el('button', '保存回复', 'comment-primary'); save.type = 'submit';
      buttons.append(save, action('取消', () => { body.value = row.reply || ''; setOpen(false); }, 'comment-secondary'));
      form.append(label, buttons);
      form.addEventListener('submit', event => { event.preventDefault(); void change(item, row.id, 'reply', { body: body.value }); });
      tools.append(toggle); item.append(form);
    }
    if (row.state === 'pending') tools.append(action('同意公开', () => { void change(item, row.id, 'publish'); }));
    if (row.state === 'hidden') tools.append(action('恢复留言', () => { void change(item, row.id, 'restore'); }));
    else tools.append(action('隐藏留言', async () => {
      const hint = '隐藏后仅留言者和站主可见，30 天内可恢复。' + (row.reports ? '现有反馈会一并标记为已处理。' : '');
      if (await confirmComment(row, '隐藏这条留言？', hint, '确认隐藏')) void change(item, row.id, 'hide');
    }));
    item.append(notice());
    return item;
  }

  async function load(append = false) {
    const active = ++version;
    more.disabled = true;
    showNotice(status, '正在加载留言…');
    try {
      const params = new URLSearchParams({ filter });
      if (append && next) params.set('before', next);
      const data = await requestJson<Page<AdminRow>>(api + '?' + params);
      if (active !== version) return;
      if (!append) list.replaceChildren();
      list.append(...data.items.map(card));
      next = data.next; more.hidden = !next; more.textContent = '加载更多';
      updateEmptyState();
    } catch (error) {
      if (active !== version) return;
      showNotice(status, errorMessage(error), 'error'); more.hidden = false; more.textContent = '重试';
    } finally { if (active === version) more.disabled = false; }
  }
  tabs.forEach(tab => tab.addEventListener('click', () => {
    if (filter === tab.dataset.filter) return;
    filter = tab.dataset.filter!; next = null; more.hidden = true;
    list.replaceChildren();
    tabs.forEach(button => button.setAttribute('aria-pressed', String(tab === button)));
    void load();
  }));
  more.addEventListener('click', () => { void load(!!next); });
  void load();
}
