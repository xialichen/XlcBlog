import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as settled } from 'node:timers/promises';
import { manualVerification } from '../src/lib/comment-verification.ts';

function formControls(action) {
  const start = Object.assign(new EventTarget(), { disabled: true });
  const submit = { disabled: true }, container = { hidden: true }, status = {};
  const elements = {
    '[data-verify-start]': start, '[type=submit]': submit,
    '[data-verification]': container, '[role=status]': status,
  };
  const check = manualVerification({ querySelector: selector => elements[selector] }, action);
  return { ...check, start, submit, container, status, click: () => start.dispatchEvent(new Event('click')) };
}

test('点击才加载验证，验证通过后令牌只能提交一次', async t => {
  const scripts = [], renders = [], removed = [];
  globalThis.window = {};
  globalThis.document = {
    createElement: () => ({ remove() {} }), head: { append: script => scripts.push(script) },
  };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  const comment = formControls('comment'), feedback = formControls('feedback');
  comment.prepare('public-key');
  feedback.prepare('public-key');
  assert.equal(scripts.length, 0);
  assert.equal(comment.start.disabled, false);
  assert.equal(comment.submit.disabled, true);
  assert.equal(comment.takeToken(), '');

  comment.click();
  comment.click();
  assert.equal(scripts.length, 1);
  scripts[0].onerror();
  await settled();
  assert.equal(comment.start.disabled, false);
  assert.equal(comment.submit.disabled, true);
  comment.click();
  feedback.click();
  feedback.prepare(''); // The visitor closed the dialog while the shared script was loading.
  assert.equal(scripts.length, 2);
  window.turnstile = {
    render(container, options) {
      assert.equal(container, comment.container);
      renders.push(options);
      return String(renders.length);
    },
    remove: id => removed.push(id),
  };
  scripts[1].onload();
  await settled();
  assert.equal(renders.length, 1);
  const challenge = renders[0];
  assert.equal(challenge.action, 'comment');
  assert.equal(comment.container.hidden, false);
  assert.equal(comment.submit.disabled, true);
  challenge.callback('one-use-token');
  assert.equal(comment.submit.disabled, false);
  assert.equal(feedback.submit.disabled, true);
  assert.equal(comment.takeToken(), 'one-use-token');
  assert.equal(comment.submit.disabled, true);
  assert.equal(comment.takeToken(), '');
  challenge.callback('late-token');
  assert.equal(comment.submit.disabled, true);
  comment.prepare('public-key');
  assert.deepEqual(removed, ['1']);
  assert.equal(renders.length, 1);
});

test('失败、过期和超时都要再次点击，旧回调不能解锁提交', async t => {
  const renders = [];
  globalThis.window = { turnstile: {
    render(container, options) {
      assert.equal(container, form.container);
      renders.push(options);
      return String(renders.length);
    },
    remove() {},
  } };
  t.after(() => { delete globalThis.window; });
  const form = formControls('feedback');
  form.prepare('public-key');
  for (const event of ['expired-callback', 'timeout-callback', 'error-callback']) {
    const count = renders.length;
    form.click();
    await settled();
    assert.equal(renders.length, count + 1);
    const challenge = renders.at(-1);
    assert.equal(challenge.action, 'feedback');
    assert.equal(challenge.retry, 'never');
    assert.equal(challenge['refresh-expired'], 'never');
    assert.equal(challenge['refresh-timeout'], 'never');
    if (event === 'expired-callback') challenge.callback('about-to-expire');
    challenge[event]();
    challenge.callback('stale-token');
    assert.equal(form.takeToken(), '');
    assert.equal(form.submit.disabled, true);
    assert.equal(form.container.hidden, true);
    assert.equal(form.start.disabled, false);
    assert.equal(form.start.textContent, '重新验证');
    assert.equal(renders.length, count + 1);
  }
});
