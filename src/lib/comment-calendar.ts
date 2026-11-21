import { filterPopup } from './comment-filter-controls';
import { el } from './comment-view';

function calendarDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}

function dateKey(date: Date) {
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = calendarDate(year, month - 1, day);
  return year > 0 && dateKey(date) === value ? date : null;
}

// 用本地日历换日，夏令时切换时也以次日零点为结束边界。
export function localMidnight(value: string, offset = 0) {
  const [year, month, day] = value.split('-').map(Number);
  return String(calendarDate(year, month - 1, day + offset).getTime());
}

export function mountCommentCalendar(form: HTMLFormElement) {
  const start = form.elements.namedItem('startDate') as HTMLInputElement;
  const end = form.elements.namedItem('endDate') as HTMLInputElement;
  const panel = form.querySelector<HTMLElement>('.filter-calendar')!;
  const grid = panel.querySelector<HTMLElement>('.calendar-days')!;
  const heading = panel.querySelector<HTMLElement>('[data-month]')!;
  const label = panel.querySelector<HTMLElement>('[data-date-label]')!;
  const today = panel.querySelector<HTMLButtonElement>('[data-today]')!;
  const clear = panel.querySelector<HTMLButtonElement>('[data-clear-date]')!;
  const steps = [...panel.querySelectorAll<HTMLButtonElement>('[data-month-step]')];
  const popup = filterPopup(panel);
  const longDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' });
  let input = start, cursor = new Date();

  function validate() {
    for (const field of [start, end]) {
      field.setCustomValidity(field.value && !parseDate(field.value) ? '请输入有效日期，格式为 YYYY-MM-DD。' : '');
    }
    if (parseDate(start.value) && parseDate(end.value) && start.value > end.value)
      end.setCustomValidity('结束日期不能早于开始日期。');
  }
  function choose(value: string) {
    input.value = value;
    validate();
    popup.close(true);
  }
  function bounds() {
    return {
      min: (input === end && parseDate(start.value)) || calendarDate(1, 0, 1),
      max: (input === start && parseDate(end.value)) || calendarDate(9999, 11, 31),
    };
  }
  function clamp(date: Date) {
    const { min, max } = bounds();
    return date < min ? min : date > max ? max : date;
  }
  function render(focusDay: boolean) {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const first = calendarDate(year, month, 1), last = calendarDate(year, month + 1, 0);
    const { min, max } = bounds();
    const todayKey = dateKey(new Date());
    const monthTitle = `${year} 年 ${month + 1} 月`;
    if (heading.textContent !== monthTitle) heading.textContent = monthTitle;
    steps[0].disabled = first <= min; steps[1].disabled = last >= max;
    today.disabled = todayKey < dateKey(min) || todayKey > dateKey(max);
    clear.disabled = !input.value;
    const days = [];
    for (let day = 1; day <= last.getDate(); day++) {
      const date = calendarDate(year, month, day), key = dateKey(date);
      const button = el('button', String(day));
      button.type = 'button'; button.value = key;
      button.tabIndex = day === cursor.getDate() ? 0 : -1;
      button.disabled = date < min || date > max;
      button.setAttribute('aria-label', longDate.format(date));
      button.setAttribute('aria-pressed', String(key === input.value));
      if (key === todayKey) button.setAttribute('aria-current', 'date');
      if (key === start.value || key === end.value) button.dataset.endpoint = '';
      if (start.value && end.value && start.value < key && key < end.value) button.dataset.inRange = '';
      if (day === 1) button.style.gridColumnStart = String((first.getDay() + 6) % 7 + 1);
      days.push(button);
    }
    grid.replaceChildren(...days);
    if (focusDay) grid.querySelector<HTMLButtonElement>('[tabindex="0"]')!.focus();
  }
  function shiftMonth(offset: number, focusDay: boolean) {
    const year = cursor.getFullYear(), month = cursor.getMonth() + offset;
    const day = Math.min(cursor.getDate(), calendarDate(year, month + 1, 0).getDate());
    cursor = clamp(calendarDate(year, month, day));
    render(focusDay);
  }
  for (const trigger of form.querySelectorAll<HTMLButtonElement>('[data-pick-date]')) {
    const field = trigger.dataset.pickDate === start.name ? start : end;
    trigger.addEventListener('click', () => {
      if (!popup.toggle(trigger)) return;
      input = field;
      const other = input === start ? end : start;
      cursor = clamp(parseDate(input.value) ?? parseDate(other.value) ?? new Date());
      panel.setAttribute('aria-label', trigger.getAttribute('aria-label')!);
      label.textContent = input === start ? '开始日期' : '结束日期';
      clear.textContent = '清除' + label.textContent;
      render(true);
    });
    field.addEventListener('input', validate);
    field.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); trigger.click(); }
    });
  }
  steps.forEach(button => button.addEventListener('click', () => {
    shiftMonth(Number(button.dataset.monthStep), false);
    if (button.disabled) grid.querySelector<HTMLButtonElement>('[tabindex="0"]')!.focus();
  }));
  grid.addEventListener('click', event => {
    if (event.target instanceof HTMLButtonElement) choose(event.target.value);
  });
  grid.addEventListener('keydown', event => {
    const weekday = (cursor.getDay() + 6) % 7;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      shiftMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1), true);
    } else if (Object.hasOwn(offsets, event.key)) {
      event.preventDefault();
      cursor = clamp(calendarDate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + offsets[event.key]));
      render(true);
    }
  });
  today.addEventListener('click', () => choose(dateKey(new Date())));
  clear.addEventListener('click', () => choose(''));
  form.addEventListener('reset', () => { popup.close(); start.setCustomValidity(''); end.setCustomValidity(''); });
  return validate;
}
