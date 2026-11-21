import {
  action, commentCard, commentPreview, confirmComment, el, errorMessage, notice, requestJson, showNotice,
  type CommentRow, type Page,
} from './comment-view';
import { attachTurnstile } from './comment-verification';

export function mountComments(root: HTMLElement) {
  const post = root.dataset.article!, keyName = 'xlc.comments.owner.' + post;
  const form = root.querySelector<HTMLFormElement>('[data-compose]')!;
  const body = form.elements.namedItem('body') as HTMLTextAreaElement;
  const status = root.querySelector<HTMLElement>('[data-submit-status]')!;
  const listStatus = root.querySelector<HTMLElement>('[data-list-status]')!;
  const list = root.querySelector<HTMLOListElement>('[data-comments-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const dialog = root.querySelector<HTMLDialogElement>('[data-feedback]')!;
  const reportForm = dialog.querySelector('form')!;
  const reportStatus = reportForm.querySelector<HTMLElement>('[data-feedback-status]')!;
  const preview = reportForm.querySelector<HTMLElement>('[data-feedback-preview]')!;
  const check = attachTurnstile(form, 'comment'), reportCheck = attachTurnstile(reportForm, 'feedback');
  const reported = new Set<string>(), withdrawn = new Set<string>();
  let sitekey = '', next: string | null = null, currentLoad = 0;
  let lastSubmitted = '';
  let report: { row: CommentRow; id: string } | undefined;
  let submission: { signature: string; id: string } | undefined;

  function owner(create = false) {
    try {
      let value = localStorage.getItem(keyName);
      if (!value && create) {
        value = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(keyName, value);
      }
      return value;
    } catch {
      if (create) throw new Error('请允许此站点保存撤回凭证后再发表。');
      return null;
    }
  }
  function send(path: string, data: object, key?: string | null) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['X-Comment-Key'] = key;
    return requestJson<{ id?: string; state?: string }>(path, { method: 'POST', headers, body: JSON.stringify(data) });
  }
  function showReport(row: CommentRow) {
    report = { row, id: crypto.randomUUID() };
    reportForm.reset(); reportStatus.textContent = '';
    preview.replaceChildren(commentPreview(row));
    dialog.showModal();
    void reportCheck.show(sitekey);
    if (!sitekey) showNotice(reportStatus, '反馈暂时不可用，请稍后重试。', 'error');
  }

  function findItem(id: string) {
    return list.querySelector<HTMLElement>('[data-comment-id="' + CSS.escape(id) + '"]');
  }

  async function withdraw(row: CommentRow) {
    const confirmed = await confirmComment(row, '撤回这条留言？', '留言及其站主回复将被永久移除。', '确认撤回');
    const item = findItem(row.id);
    if (!confirmed || !item) return;
    const note = item.querySelector<HTMLElement>('.comment-notice')!;
    const buttons = item.querySelectorAll('button');
    showNotice(note, '正在撤回…');
    if (item.contains(document.activeElement)) note.focus({ preventScroll: true });
    buttons.forEach(button => { button.disabled = true; });
    try {
      await send('/api/comments/' + row.id + '/withdraw', { post }, owner());
      withdrawn.add(row.id);
      if (lastSubmitted === row.id) { status.textContent = ''; lastSubmitted = ''; }
      const current = findItem(row.id);
      if (current) {
        const currentNote = current.querySelector<HTMLElement>('.comment-notice')!;
        const focused = current.contains(document.activeElement);
        current.replaceChildren(currentNote);
        current.classList.add('comment-receipt');
        showNotice(currentNote, '你的留言已撤回。', 'success');
        if (focused) currentNote.focus({ preventScroll: true });
      }
    } catch (error) {
      showNotice(findItem(row.id)?.querySelector('.comment-notice') || listStatus, errorMessage(error), 'error');
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function publicCard(row: CommentRow) {
    const { item, header } = commentCard(row);
    const actions = el('div', '', 'comment-actions comment-row-actions');
    if (row.state === 'published') actions.append(action('反馈', () => showReport(row)));
    if (row.mine) actions.append(action('撤回', () => { void withdraw(row); }));
    header.append(actions);
    const note = notice();
    if (reported.has(row.id)) showNotice(note, '反馈已提交，站主会查看。', 'success');
    item.append(note);
    return item;
  }
  async function reload(append = false) {
    const version = ++currentLoad;
    more.disabled = true;
    try {
      const query = new URLSearchParams({ post });
      if (append && next) query.set('before', next);
      const key = owner();
      const data = await requestJson<Page<CommentRow> & { sitekey?: string }>('/api/comments?' + query, {
        headers: key ? { 'X-Comment-Key': key } : {},
      });
      if (version !== currentLoad) return;
      if (!append) list.replaceChildren();
      list.append(...data.items.filter(row => !withdrawn.has(row.id)).map(publicCard));
      next = data.next; more.hidden = !next; more.textContent = '加载更多';
      showNotice(listStatus, list.children.length ? '' : '还没有留言。');
      const newKey = data.sitekey || '';
      if (newKey !== sitekey) {
        sitekey = newKey;
        void check.show(sitekey);
        if (dialog.open) void reportCheck.show(sitekey);
      }
      if (!sitekey) showNotice(status, '发表暂时不可用。', 'error');
    } catch (error) {
      if (version !== currentLoad) return;
      showNotice(listStatus, errorMessage(error), 'error');
      more.textContent = '重试'; more.hidden = false;
    } finally { if (version === currentLoad) more.disabled = false; }
  }
  more.addEventListener('click', () => { void reload(!!next && list.children.length > 0); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const token = check.takeToken();
    if (!token) return;
    const nickname = String(new FormData(form).get('nickname') || '');
    const signature = JSON.stringify([nickname, body.value]);
    if (submission?.signature !== signature) submission = { signature, id: crypto.randomUUID() };
    lastSubmitted = '';
    showNotice(status, '正在发表…');
    try {
      const result = await send('/api/comments', { id: submission.id, post, nickname, body: body.value, token }, owner(true));
      lastSubmitted = result.id || '';
      const message = result.state === 'pending' ? '留言已收到，正在等待审核。'
        : result.state === 'hidden' ? '这条留言已被隐藏。' : '留言已发表。';
      showNotice(status, message, 'success');
      if (signature === JSON.stringify([String(new FormData(form).get('nickname') || ''), body.value])) body.value = '';
      submission = undefined;
      await reload();
      const item = lastSubmitted && findItem(lastSubmitted);
      if (item && result.id === lastSubmitted) {
        const link = el('a', '查看留言');
        link.href = '#' + item.id; status.append(' ', link);
      }
    } catch (error) { showNotice(status, errorMessage(error), 'error'); }
    finally { void check.show(sitekey); }
  });
  dialog.querySelector('[data-cancel]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!dialog.open) { report = undefined; reportCheck.clear(); }
  });
  reportForm.addEventListener('submit', async event => {
    event.preventDefault();
    const active = report;
    if (!dialog.open || !active) return;
    const token = reportCheck.takeToken();
    if (!token) return;
    showNotice(reportStatus, '正在提交反馈…');
    try {
      await send('/api/comments/' + active.row.id + '/feedback', {
        ...Object.fromEntries(new FormData(reportForm)), id: active.id, token,
      });
      reported.add(active.row.id);
      if (active === report && dialog.open) dialog.close();
      if (!withdrawn.has(active.row.id))
        showNotice(findItem(active.row.id)?.querySelector('.comment-notice') || listStatus, '反馈已提交，站主会查看。', 'success');
    } catch (error) {
      if (active === report && dialog.open) {
        showNotice(reportStatus, errorMessage(error), 'error');
        void reportCheck.show(sitekey);
      }
    }
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect(); void reload();
    }, { rootMargin: '320px' });
    observer.observe(root);
  } else void reload();
}
