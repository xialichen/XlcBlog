export interface CommentRow {
  id: string; nickname: string; body: string; state: 'pending' | 'published' | 'hidden';
  created_at: number; reply: string | null; replied_at: number | null; mine?: number;
}
export interface Page<T> { items: T[]; next: string | null; }

export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, cache: 'no-store', credentials: 'same-origin' });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('服务暂时不可用，管理页可重新登录后重试。');
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

export function action(label: string, onClick: () => void) {
  const button = el('button', label, 'comment-secondary');
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
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
  const head = el('div', '', 'comment-meta');
  const date = new Date(row.created_at);
  const time = el('time', date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }));
  time.dateTime = date.toISOString();
  head.append(el('strong', row.nickname), time);
  if (row.state !== 'published') head.append(el('span', row.state === 'pending' ? '待审核' : '已隐藏', 'comment-state'));
  li.append(head, textBody(row.body));
  if (row.reply) {
    const reply = el('div', '', 'comment-reply');
    reply.append(el('strong', '站主回复'), textBody(row.reply));
    li.append(reply);
  }
  return li;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。';
}
