interface Turnstile {
  render(target: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

let script: Promise<Turnstile> | undefined;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!script) script = new Promise<Turnstile>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    tag.async = true;
    const failed = () => { tag.remove(); reject(new Error('人机验证加载失败。')); };
    tag.onload = () => window.turnstile ? resolve(window.turnstile) : failed();
    tag.onerror = failed;
    document.head.append(tag);
  }).catch(error => { script = undefined; throw error; });
  return script;
}

export function manualVerification(form: HTMLFormElement, action: 'comment' | 'feedback') {
  const start = form.querySelector<HTMLButtonElement>('[data-verify-start]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const container = form.querySelector<HTMLElement>('[data-verification]')!;
  const status = form.querySelector<HTMLElement>('[role=status]')!;
  let sitekey = '', token = '', generation = 0;
  let widget: string | undefined;

  function discard() {
    generation++;
    token = '';
    submit.disabled = true;
    if (widget !== undefined) window.turnstile?.remove(widget);
    widget = undefined;
    container.hidden = true;
  }
  function prepare(key: string) {
    discard();
    sitekey = key;
    start.disabled = !key;
    start.hidden = false;
    start.textContent = '开始验证';
  }
  start.addEventListener('click', async () => {
    if (start.disabled || !sitekey) return;
    const version = ++generation;
    start.disabled = true;
    start.textContent = '正在加载验证…';
    status.textContent = '';
    function retry(message: string) {
      if (version !== generation) return;
      prepare(sitekey);
      start.textContent = '重新验证';
      status.textContent = message;
    }
    try {
      const api = await loadTurnstile();
      if (version !== generation) return;
      container.hidden = false;
      const id = api.render(container, {
        sitekey, action, theme: 'auto', retry: 'never',
        'refresh-expired': 'never', 'refresh-timeout': 'never', 'response-field': false,
        callback: (value: string) => {
          if (version !== generation) return;
          token = value;
          submit.disabled = !token;
        },
        'expired-callback': () => retry('验证已过期，请重新验证。'),
        'timeout-callback': () => retry('验证已超时，请重新验证。'),
        'error-callback': () => { retry('验证失败，请重新验证。'); return true; },
        'unsupported-callback': () => retry('当前浏览器不支持人机验证，请更换浏览器。'),
      });
      if (version === generation) { widget = id; start.hidden = true; }
      else api.remove(id);
    } catch { retry('人机验证加载失败，请重新验证。'); }
  });
  return {
    prepare,
    takeToken() {
      const value = token;
      if (value) discard();
      return value;
    },
  };
}
