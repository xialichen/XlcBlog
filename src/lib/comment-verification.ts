interface Turnstile {
  render(target: HTMLElement, options: Record<string, unknown>): string;
  getResponse(id: string): string | undefined;
  isExpired(id: string): boolean;
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

export function attachTurnstile(form: HTMLFormElement, action: 'comment' | 'feedback') {
  const retry = form.querySelector<HTMLButtonElement>('[data-verify-retry]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const container = form.querySelector<HTMLElement>('[data-verification]')!;
  let sitekey = '', generation = 0;
  let widget: string | undefined;

  function clear() {
    generation++;
    sitekey = '';
    submit.disabled = true;
    retry.hidden = true;
    if (widget !== undefined) window.turnstile?.remove(widget);
    widget = undefined;
    container.hidden = true;
  }
  function currentToken() {
    const api = window.turnstile;
    if (widget === undefined || !api || api.isExpired(widget)) return '';
    return api.getResponse(widget) || '';
  }
  async function show(key: string) {
    clear();
    if (!key) return;
    sitekey = key;
    const version = generation;
    const lock = () => { if (version === generation) submit.disabled = true; };
    try {
      const api = await loadTurnstile();
      if (version !== generation) return;
      container.hidden = false;
      const id = api.render(container, {
        sitekey, action, theme: 'auto', appearance: 'always',
        size: container.clientWidth < 300 ? 'compact' : 'normal',
        'refresh-expired': 'manual', 'refresh-timeout': 'manual', 'response-field': false,
        callback: (value: string) => {
          if (version !== generation) return;
          submit.disabled = !value || (widget !== undefined && value !== currentToken());
        },
        'expired-callback': lock, 'timeout-callback': lock, 'unsupported-callback': lock,
        'error-callback': () => { lock(); return true; },
      });
      if (version === generation) widget = id;
      else api.remove(id);
    } catch {
      if (version !== generation) return;
      submit.disabled = true;
      container.hidden = true;
      retry.hidden = false;
    }
  }
  retry.addEventListener('click', () => {
    if (!retry.hidden) void show(sitekey);
  });
  return {
    show, clear,
    takeToken() {
      if (submit.disabled) return '';
      const value = currentToken();
      if (value) clear();
      else void show(sitekey);
      return value;
    },
  };
}
