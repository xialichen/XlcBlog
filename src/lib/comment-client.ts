import { action, commentCard, el, errorMessage, requestJson, type CommentRow, type Page } from './comment-view';
import { manualVerification } from './comment-verification';

export function mountComments(root: HTMLElement) {
  const post = root.dataset.article!, keyName = 'xlc.comments.owner.' + post;
  const form = root.querySelector<HTMLFormElement>('[data-compose]')!;
  const body = form.elements.namedItem('body') as HTMLTextAreaElement;
  const status = root.querySelector<HTMLElement>('[data-submit-status]')!;
  const listStatus = root.querySelector<HTMLElement>('[data-list-status]')!;
  const list = root.querySelector<HTMLOListElement>('[data-comments-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more]')!;
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  const reportForm = dialog.querySelector('form')!, reportStatus = reportForm.querySelector<HTMLElement>('[role=status]')!;
  const check = manualVerification(form, 'comment'), reportCheck = manualVerification(reportForm, 'feedback');
  let sitekey = '', next: string | null = null, target = '', reportId = '', currentLoad = 0;
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
    return requestJson<{ state?: string }>(path, { method: 'POST', headers, body: JSON.stringify(data) });
  }
  function showReport(id: string) {
    target = id; reportId = crypto.randomUUID();
    reportForm.reset(); reportStatus.textContent = '';
    dialog.showModal();
    reportCheck.prepare(sitekey);
    if (!sitekey) reportStatus.textContent = '反馈暂时不可用，请稍后重试。';
  }
  async function withdraw(id: string) {
    if (!window.confirm('撤回这条留言？对应的站主回复也会移除。')) return;
    try {
      await send('/api/comments/' + id + '/withdraw', { post }, owner());
      status.textContent = '留言已撤回。';
      await reload();
    } catch (error) { status.textContent = errorMessage(error); }
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
      for (const row of data.items) {
        const item = commentCard(row), buttons = el('div', '', 'comment-actions');
        if (row.state === 'published') buttons.append(action('反馈', () => showReport(row.id)));
        if (row.mine) buttons.append(action('撤回', () => { void withdraw(row.id); }));
        item.append(buttons); list.append(item);
      }
      next = data.next; more.hidden = !next; more.textContent = '加载更多';
      listStatus.textContent = list.children.length ? '' : '还没有留言。';
      const newKey = data.sitekey || '';
      if (newKey !== sitekey) {
        sitekey = newKey;
        check.prepare(sitekey);
        if (dialog.open) reportCheck.prepare(sitekey);
      }
      if (!sitekey) status.textContent = '发表暂时不可用。';
    } catch (error) {
      if (version !== currentLoad) return;
      listStatus.textContent = errorMessage(error);
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
    try {
      const result = await send('/api/comments', { id: submission.id, post, nickname, body: body.value, token }, owner(true));
      status.textContent = result.state === 'pending' ? '留言已收到，待审核。' : '留言已发表。';
      if (signature === JSON.stringify([String(new FormData(form).get('nickname') || ''), body.value])) body.value = '';
      submission = undefined;
      await reload();
    } catch (error) { status.textContent = errorMessage(error); }
    finally { check.prepare(sitekey); }
  });
  dialog.querySelector('[data-cancel]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!dialog.open) reportCheck.prepare(''); });
  reportForm.addEventListener('submit', async event => {
    event.preventDefault();
    const token = reportCheck.takeToken();
    if (!token) return;
    const id = reportId;
    try {
      await send('/api/comments/' + target + '/feedback', {
        ...Object.fromEntries(new FormData(reportForm)), id, token,
      });
      if (id === reportId && dialog.open) dialog.close();
      status.textContent = '反馈已收到，站主会集中处理。';
    } catch (error) {
      if (id === reportId && dialog.open) {
        reportStatus.textContent = errorMessage(error);
        reportCheck.prepare(sitekey);
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
