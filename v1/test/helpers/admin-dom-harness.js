// 真实 admin.js 的 DOM stub 加载器（工作台队列测试与卡片页测试共用）。
//
// admin.js 是浏览器端全局脚本（非 module、无 IIFE），顶层函数即全局函数。F-68 那次事故
// 是「渲染函数引用了一个根本没定义的常量」——后端单测天然覆盖不到前端 JS，页面一渲染就
// ReferenceError。这里给它一个最小 DOM stub 真正执行一遍，未定义引用会在断言前先抛出来。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adminJsPath = path.join(here, '..', '..', 'public', 'admin', 'assets', 'admin.js');

// 任何属性都可读、未知属性当 no-op 函数；innerHTML 可读写，供断言取渲染结果。
export function makeEl(id) {
  const node = {
    _id: id, innerHTML: '', textContent: '', value: '', disabled: false,
    dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, remove() {}, append() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, click() {}, submit() {},
  };
  return new Proxy(node, {
    get(t, p) { return p in t ? t[p] : () => {}; },
    set(t, p, v) { t[p] = v; return true; },
  });
}

export function loadAdminJs() {
  const store = {};
  const document = {
    getElementById: (id) => (store[id] ||= makeEl(id)),
    // admin.js 顶层也用 querySelector 绑事件（如 elements.filters），返回 null 会让加载直接崩，
    // 所以这里同样给一个 stub 节点；断言只看 getElementById 那几个容器的 innerHTML。
    querySelector: (sel) => (store[`sel:${sel}`] ||= makeEl(`sel:${sel}`)),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createElement: (tag) => makeEl(`created:${tag}`),
    body: makeEl('body'), documentElement: makeEl('html'),
  };
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const win = {
    addEventListener() {}, removeEventListener() {},
    prompt: () => null, confirm: () => true, alert: () => {},
    location: { href: '', reload() {} },
    localStorage: storage, sessionStorage: storage,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    // admin.js 顶层会起自动刷新轮询；测试里必须是 no-op，真起定时器会让进程不退出。
    setInterval: () => 0, clearInterval: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
  };
  const sandbox = {
    document, window: win, console,
    fetch: () => Promise.reject(new Error('network disabled in this test')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Date, Math, JSON,
    FormData: class {}, Blob: class {}, AbortController,
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    location: win.location, localStorage: storage, sessionStorage: storage,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(adminJsPath, 'utf8'), sandbox, { filename: 'admin.js' });
  // 注意：顶层 const/let 是全局词法绑定，不会挂到 sandbox(globalThis) 上（只有 function/var 会）。
  // 所以查常量必须在脚本作用域里求值，不能读 sandbox.XXX。
  const evalIn = (expr) => vm.runInContext(expr, sandbox);
  return { sandbox, evalIn, html: (id) => store[id]?.innerHTML || '' };
}
