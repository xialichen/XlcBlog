export interface CommentRow {
  id: string; nickname: string; body: string; state: 'pending' | 'published' | 'hidden';
  created_at: number; reply: string | null; replied_at: number | null; mine?: number;
}
export interface Page<T> { items: T[]; next: string | null; }

export const feedbackReasons: Record<string, string> = {
  spam: '广告或刷屏', abuse: '攻击或泄露隐私', removal: '申请移除我的留言', other: '其他原因',
};

export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, cache: 'no-store', credentials: 'same-origin' });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(path.startsWith('/admin/') ? '请重新登录评论管理页后重试。' : '评论服务暂时不可用，请稍后重试。');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请重试。');
  return data;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function action(label: string, onClick: () => void, className = 'comment-action') {
  const button = el('button', label, className);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

export function notice() {
  const node = el('p', '', 'comment-notice');
  node.setAttribute('role', 'status');
  node.tabIndex = -1;
  return node;
}

export function showNotice(node: HTMLElement, text: string, tone: 'success' | 'error' | 'info' = 'info') {
  node.dataset.tone = tone;
  node.textContent = text;
}

export function commentTime(timestamp: number) {
  const date = new Date(timestamp);
  const time = el('time', date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }));
  time.dateTime = date.toISOString();
  return time;
}

export function commentPreview(row: CommentRow) {
  const quote = el('blockquote', '', 'comment-quote');
  quote.append(el('strong', row.nickname), el('p', row.body));
  return quote;
}

export function confirmComment(row: CommentRow, title: string, description: string, accept: string) {
  const dialog = el('dialog', '', 'comment-dialog');
  const heading = el('h3', title), hint = el('p', description, 'comment-hint');
  heading.id = 'confirm-' + row.id;
  hint.id = 'consequence-' + row.id;
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.setAttribute('aria-describedby', hint.id);
  const form = el('form', '', 'comment-form');
  form.method = 'dialog';
  const buttons = el('div', '', 'comment-actions comment-dialog-actions');
  const cancel = el('button', '取消', 'comment-secondary');
  cancel.type = 'submit'; cancel.value = 'cancel'; cancel.autofocus = true;
  const confirm = el('button', accept, 'comment-danger');
  confirm.type = 'submit'; confirm.value = 'confirm';
  buttons.append(cancel, confirm);
  form.append(heading, commentPreview(row), hint, buttons);
  dialog.append(form);
  document.body.append(dialog);
  return new Promise<boolean>(resolve => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'confirm');
    }, { once: true });
    dialog.showModal();
  });
}

function textBody(value: string) {
  const p = el('p', '', 'comment-text');
  let from = 0;
  for (const match of value.matchAll(/https?:\/\/[^\s<>"，。；！？、（）【】]+/giu)) {
    const start = match.index!;
    const candidate = match[0].replace(/[.,;!?）)]+$/u, '');
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const link = el('a', candidate);
    link.href = url.href;
    link.rel = 'ugc nofollow noopener noreferrer';
    link.target = '_blank';
    p.append(value.slice(from, start), link);
    from = start + candidate.length;
  }
  p.append(value.slice(from));
  return p;
}

export function commentCard(row: CommentRow) {
  const li = el('li', '', 'comment-item');
  li.id = 'comment-' + row.id;
  li.dataset.commentId = row.id;
  const head = el('div', '', 'comment-meta');
  head.append(el('strong', row.nickname, 'comment-author'));
  if (row.mine) head.append(el('span', '我的留言', 'comment-mine'));
  if (row.state !== 'published') head.append(el('span', row.state === 'pending' ? '待审核' : '已隐藏', 'comment-state'));
  head.append(commentTime(row.created_at));
  const header = el('div', '', 'comment-header');
  header.append(head);
  li.append(header, textBody(row.body));
  if (row.reply) {
    const reply = el('div', '', 'comment-reply');
    const meta = el('div', '', 'comment-meta');
    meta.append(el('strong', '站主回复'));
    if (row.replied_at) meta.append(commentTime(row.replied_at));
    reply.append(meta, textBody(row.reply));
    li.append(reply);
  }
  return { item: li, header };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。';
}
