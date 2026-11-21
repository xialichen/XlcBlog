import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as settled } from 'node:timers/promises';
import { attachTurnstile } from '../src/lib/comment-verification.ts';

function formControls(action, width = 360) {
  const retry = Object.assign(new EventTarget(), { hidden: true });
  const submit = { disabled: true }, container = { hidden: true, clientWidth: width };
  const elements = { '[data-verify-retry]': retry, '[type=submit]': submit, '[data-verification]': container };
  const check = attachTurnstile({ querySelector: selector => elements[selector] }, action);
  return { ...check, retry, submit, container };
}

function widgetSdk() {
  const widgets = [];
  return {
    widgets,
    render(container, options) {
      widgets.push({ container, options, token: '', expired: false, removed: false });
      return String(widgets.length - 1);
    },
    getResponse: id => widgets[id].token,
    isExpired: id => widgets[id].expired,
    remove(id) { widgets[id].removed = true; },
  };
}

function solve(widget, value) {
  widget.expired = false;
  widget.token = value;
  widget.options.callback(value);
}

test('显示表单即显示原生验证框，每个表单只能使用自己的令牌一次', async t => {
  const sdk = widgetSdk();
  globalThis.window = { turnstile: sdk };
  t.after(() => { delete globalThis.window; });
  const comment = formControls('comment'), feedback = formControls('feedback', 260);
  await comment.show('public-key');
  assert.equal(sdk.widgets.length, 1);
  const widget = sdk.widgets[0];
  assert.equal(widget.container, comment.container);
  assert.equal(widget.options.appearance, 'always');
  assert.equal(widget.options.action, 'comment');
  assert.equal(widget.options.size, 'normal');
  assert.equal(comment.container.hidden, false);
  assert.equal(comment.retry.hidden, true);
  assert.equal(comment.submit.disabled, true);
  assert.equal(comment.takeToken(), '');

  await feedback.show('public-key');
  assert.equal(sdk.widgets[1].options.action, 'feedback');
  assert.equal(sdk.widgets[1].options.size, 'compact');
  solve(widget, 'comment-token');
  assert.equal(comment.submit.disabled, false);
  assert.equal(feedback.submit.disabled, true);
  assert.equal(comment.takeToken(), 'comment-token');
  assert.equal(comment.takeToken(), '');
  assert.equal(widget.removed, true);
  solve(widget, 'late-token');
  assert.equal(comment.submit.disabled, true);
  solve(sdk.widgets[1], 'feedback-token');
  assert.equal(feedback.takeToken(), 'feedback-token');
});

test('加载失败时可原地重试，共用脚本加载期间关闭的表单保持关闭', async t => {
  const scripts = [], sdk = widgetSdk();
  globalThis.window = {};
  globalThis.document = {
    createElement: () => ({ remove() {} }), head: { append: tag => scripts.push(tag) },
  };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  const comment = formControls('comment'), feedback = formControls('feedback');
  await comment.show('');
  assert.equal(scripts.length, 0);
  const loading = comment.show('public-key');
  assert.equal(scripts.length, 1);
  scripts[0].onerror();
  await loading;
  assert.equal(comment.retry.hidden, false);
  assert.equal(comment.submit.disabled, true);

  comment.retry.dispatchEvent(new Event('click'));
  const opening = feedback.show('public-key');
  feedback.clear();
  assert.equal(scripts.length, 2);
  window.turnstile = sdk;
  scripts[1].onload();
  await opening;
  await settled();
  assert.equal(comment.retry.hidden, true);
  assert.equal(sdk.widgets.length, 1);
  assert.equal(sdk.widgets[0].container, comment.container);
  assert.equal(feedback.container.hidden, true);
  assert.equal(feedback.submit.disabled, true);
});

test('过期、超时或失败时锁定提交，可在原生框重新验证', async t => {
  const sdk = widgetSdk();
  globalThis.window = { turnstile: sdk };
  t.after(() => { delete globalThis.window; });
  const form = formControls('comment');
  await form.show('public-key');
  const widget = sdk.widgets[0];
  assert.equal(widget.options['refresh-expired'], 'manual');
  assert.equal(widget.options['refresh-timeout'], 'manual');
  for (const event of ['expired-callback', 'timeout-callback', 'error-callback']) {
    solve(widget, 'current-token');
    assert.equal(form.submit.disabled, false);
    widget.token = '';
    widget.options[event]();
    widget.options.callback('stale-token');
    assert.equal(form.submit.disabled, true);
    assert.equal(form.takeToken(), '');
    assert.equal(form.container.hidden, false);
    assert.equal(form.retry.hidden, true);
    assert.equal(sdk.widgets.length, 1);
  }
  solve(widget, 'token-before-tab-slept');
  widget.expired = true; // The browser resumed before the expiry callback ran.
  assert.equal(form.takeToken(), '');
  assert.equal(form.submit.disabled, true);
  await settled();
  solve(sdk.widgets[1], 'fresh-token');
  assert.equal(form.takeToken(), 'fresh-token');
});
