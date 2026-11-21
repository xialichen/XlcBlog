import { el } from './comment-view';

export function filterPopup(panel: HTMLElement) {
  let anchor: HTMLButtonElement | null = null;
  function close(restoreFocus = false) {
    if (!anchor) return;
    const button = anchor;
    anchor = null;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  }
  const outside = (event: Event) => {
    if (anchor && event.target instanceof Node && !panel.contains(event.target) && !anchor.contains(event.target)) close();
  };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', outside);
  panel.parentElement!.addEventListener('keydown', event => {
    if (anchor && event.key === 'Escape') { event.preventDefault(); close(true); }
  });
  return {
    close,
    toggle(button: HTMLButtonElement) {
      const opening = button !== anchor;
      close();
      if (opening) {
        anchor = button;
        panel.hidden = false;
        button.setAttribute('aria-expanded', 'true');
      }
      return opening;
    },
  };
}

export interface ArticleOption { article: string; title: string; category: string | null; }

export function mountArticlePicker(root: HTMLElement) {
  const field = root.querySelector('input')!;
  const trigger = root.querySelector('button')!;
  const label = root.querySelector<HTMLElement>('#article-choice')!;
  const menu = root.querySelector<HTMLElement>('[role=listbox]')!;
  const popup = filterPopup(menu);
  let articles: ArticleOption[] | undefined;
  let category = '';

  function select(value: string) {
    field.value = value;
    for (const option of menu.querySelectorAll('button')) {
      const selected = option.value === value;
      option.setAttribute('aria-selected', String(selected));
      if (selected) label.textContent = option.textContent;
    }
  }
  function render() {
    popup.close();
    const visible = (articles ?? []).filter(entry => !category || entry.category === category);
    const titles = new Set<string>(), duplicates = new Set<string>();
    for (const entry of visible) {
      if (titles.has(entry.title)) duplicates.add(entry.title);
      titles.add(entry.title);
    }
    const choices = [{ article: '', title: '全部文章' }, ...visible];
    menu.replaceChildren(...choices.map(entry => {
      const name = entry.article && duplicates.has(entry.title) ? `${entry.title}（${entry.article}）` : entry.title;
      const option = el('button', name);
      option.type = 'button'; option.value = entry.article; option.tabIndex = -1;
      option.setAttribute('role', 'option');
      option.addEventListener('click', () => { select(entry.article); popup.close(true); });
      return option;
    }));
    select(visible.some(entry => entry.article === field.value) ? field.value : '');
    trigger.disabled = visible.length === 0;
    if (articles && !visible.length) label.textContent = '暂无可选文章';
  }
  function open() {
    if (popup.toggle(trigger)) menu.querySelector<HTMLElement>('[aria-selected=true]')?.focus();
  }
  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
  });
  let prefix = '', lastKey = 0;
  menu.addEventListener('keydown', event => {
    if (event.key === 'Tab') { popup.close(true); return; }
    const choices = [...menu.querySelectorAll('button')];
    const at = choices.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowDown': next = choices[Math.min(at + 1, choices.length - 1)]; break;
      case 'ArrowUp': next = choices[Math.max(at - 1, 0)]; break;
      case 'Home': next = choices[0]; break;
      case 'End': next = choices.at(-1); break;
      default:
        if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
        prefix = (event.timeStamp - lastKey < 700 ? prefix : '') + event.key.toLocaleLowerCase();
        lastKey = event.timeStamp;
        next = choices.find(option => option.textContent?.toLocaleLowerCase().startsWith(prefix));
    }
    if (next) { event.preventDefault(); next.focus(); }
  });
  return {
    get ready() { return articles !== undefined; },
    setArticles(entries: ArticleOption[]) { articles = entries; render(); },
    reset(nextCategory: string) { category = nextCategory; field.value = ''; render(); },
  };
}
