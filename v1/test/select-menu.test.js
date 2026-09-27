import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// D-405 第三批：下拉点开后的菜单（select-menu.js）。交互在真页面上逐项点过；这里钉住三段纯逻辑与接线方式。
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'assets', 'select-menu.js'), 'utf8');
const html = fs.readFileSync(path.join(here, '..', 'public', 'admin', 'index.html'), 'utf8');
const logicOf = () => { const sandbox = { window: {} }; vm.runInNewContext(source, sandbox); return sandbox.window.selectMenuLogic; };
const opts = (...list) => list.map((item) => (typeof item === 'string' ? { label: item, disabled: false } : item));

test('上下键跳过不可选项、首尾循环；全都不可选时原地不动', () => {
  const { step } = logicOf();
  const list = opts('所有路线', { label: 'Browser', disabled: true }, 'API');
  assert.equal(step(list, 0, 1), 2, '跳过 Browser');
  assert.equal(step(list, 2, 1), 0, '到底回到头');
  assert.equal(step(list, 0, -1), 2);
  assert.equal(step(list, 2, 1 - 2), 0);
  assert.equal(step(opts({ label: 'a', disabled: true }), 0, 1), 0);
  assert.equal(step([], 0, 1), -1);
});

test('首字母跳：不分大小写、跳过不可选项；没有匹配返回 -1', () => {
  const { typeahead } = logicOf();
  const list = opts('所有路线', 'Browser', { label: 'API 旧', disabled: true }, 'API');
  assert.equal(typeahead(list, 'a'), 3);
  assert.equal(typeahead(list, 'B'), 1);
  assert.equal(typeahead(list, 'x'), -1);
  assert.equal(typeahead(list, ''), -1);
});

test('下面放不下、上面更宽裕时往上开', () => {
  const { placement } = logicOf();
  assert.equal(placement({ triggerTop: 100, triggerBottom: 134, boundsTop: 0, boundsBottom: 730, menuHeight: 170 }), 'down');
  assert.equal(placement({ triggerTop: 650, triggerBottom: 684, boundsTop: 0, boundsBottom: 730, menuHeight: 170 }), 'up');
  assert.equal(placement({ triggerTop: 300, triggerBottom: 334, boundsTop: 0, boundsBottom: 500, menuHeight: 280 }), 'up', '两边都放不下时选更宽的一边（上面 292 > 下面 158）');
  assert.equal(placement({ triggerTop: 150, triggerBottom: 184, boundsTop: 0, boundsBottom: 420, menuHeight: 280 }), 'down', '两边都放不下、下面更宽（228 > 142）');
});

test('接线：在 admin.js 之前加载；触屏与 data-native-menu 保留系统菜单；选中后派发 input / change；弹窗里挂进 dialog', () => {
  assert.ok(html.indexOf('select-menu.js?v=') > -1 && html.indexOf('select-menu.js?v=') < html.indexOf('admin.js?v='));
  assert.match(source, /matchMedia\('\(pointer: coarse\)'\)\.matches\) return;/);
  assert.match(source, /!select\.hasAttribute\('data-native-menu'\)/);
  assert.match(source, /dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\);\s*select\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  assert.match(source, /\(select\.closest\('dialog\[open\]'\) \|\| document\.body\)\.appendChild\(menu\)/);
  assert.match(source, /event\.key === 'Escape'\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); close\(\); \}/, 'Esc 只关菜单、不关弹窗');
});
