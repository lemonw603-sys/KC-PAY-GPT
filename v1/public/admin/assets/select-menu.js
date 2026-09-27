// 下拉点开后的菜单换成后台自己的（D-405 第三批，Lemon 2026-09-27「下拉点开后有割裂感和廉价感」，
// 2026-09-28 看过演示后「可以开始做吧」）。
//
// 做法：收起时仍是原生 <select>（第二批统一过的样子、宽度、禁用、隐藏、代码里 select.value = … 全都照旧），
// 只在它要弹出系统菜单的那一下拦住，换成一个用候光令牌画的菜单；选中后写回 select 并派发 input / change，
// 页面上已有的监听不用改。触屏设备保留系统菜单（手机上系统滚轮更好用）。
// 某个下拉要保留系统菜单：给它加 data-native-menu。
(function () {
  const logic = {
    /** 从 from 往 dir（±1）找下一个可选项；全都不可选时原地不动。 */
    step(options, from, dir) {
      const n = options.length;
      if (!n) return -1;
      let i = from;
      for (let k = 0; k < n; k += 1) {
        i = (i + dir + n) % n;
        if (!options[i].disabled) return i;
      }
      return from;
    },
    /** 首字母跳：第一个以 typed 开头的可选项（不分大小写）；没有返回 -1。 */
    typeahead(options, typed) {
      const want = String(typed || '').toLowerCase();
      if (!want) return -1;
      return options.findIndex((option) => !option.disabled && String(option.label).toLowerCase().startsWith(want));
    },
    /** 下面放不下、上面放得下更多时往上开。 */
    placement({ triggerTop, triggerBottom, boundsTop, boundsBottom, menuHeight }) {
      const below = boundsBottom - triggerBottom - 8;
      const above = triggerTop - boundsTop - 8;
      return below >= menuHeight || below >= above ? 'down' : 'up';
    }
  };
  window.selectMenuLogic = logic;
  if (typeof document === 'undefined' || !document.addEventListener) return;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;

  const MAX_HEIGHT = 280;
  let current = null; // { select, menu, active, typed, typedAt }

  const optionsOf = (select) => [...select.options].map((option) => ({
    label: option.label || option.text, disabled: option.disabled || Boolean(option.parentElement?.disabled)
  }));
  const handles = (select) => select instanceof HTMLSelectElement && !select.disabled && !select.multiple
    && !(select.size > 1) && !select.hasAttribute('data-native-menu');

  function setActive(index) {
    if (!current) return;
    current.active = index;
    [...current.menu.children].forEach((item, i) => item.classList.toggle('is-active', i === index));
    current.menu.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function place() {
    const { select, menu } = current;
    const rect = select.getBoundingClientRect();
    const dialog = select.closest('dialog[open]');
    const bounds = dialog ? dialog.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    menu.style.minWidth = `${Math.round(rect.width)}px`;
    menu.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    const natural = Math.min(menu.scrollHeight, MAX_HEIGHT);
    const side = logic.placement({ triggerTop: rect.top, triggerBottom: rect.bottom,
      boundsTop: Math.max(0, bounds.top), boundsBottom: Math.min(window.innerHeight, bounds.bottom), menuHeight: natural });
    const room = side === 'down' ? Math.min(window.innerHeight, bounds.bottom) - rect.bottom - 8 : rect.top - Math.max(0, bounds.top) - 8;
    menu.style.maxHeight = `${Math.max(96, Math.min(MAX_HEIGHT, room))}px`;
    menu.classList.toggle('is-up', side === 'up');
    if (side === 'down') { menu.style.top = `${Math.round(rect.bottom + 4)}px`; menu.style.bottom = ''; }
    else { menu.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`; menu.style.top = ''; }
  }

  function open(select) {
    close({ focus: false });
    const menu = document.createElement('div');
    menu.className = `sel-menu${select.closest('.wb-ops') ? ' is-sm' : ''}`;
    menu.setAttribute('role', 'listbox');
    const options = optionsOf(select);
    options.forEach((option, index) => {
      const item = document.createElement('div');
      item.className = 'sel-opt';
      item.setAttribute('role', 'option');
      item.dataset.index = String(index);
      item.setAttribute('aria-selected', String(index === select.selectedIndex));
      if (option.disabled) item.setAttribute('aria-disabled', 'true');
      item.textContent = option.label;
      menu.appendChild(item);
    });
    // 在打开的 <dialog> 里就挂进 dialog：dialog 在顶层，挂到 body 会被它的遮罩盖住
    (select.closest('dialog[open]') || document.body).appendChild(menu);
    current = { select, menu, active: -1, typed: '', typedAt: 0 };
    select.classList.add('is-menu-open');
    place();
    setActive(select.selectedIndex >= 0 ? select.selectedIndex : logic.step(options, -1, 1));
    menu.addEventListener('mousedown', (event) => event.preventDefault());
    menu.addEventListener('mousemove', (event) => {
      const item = event.target.closest('.sel-opt');
      if (item && item.getAttribute('aria-disabled') !== 'true') setActive(Number(item.dataset.index));
    });
    menu.addEventListener('click', (event) => {
      const item = event.target.closest('.sel-opt');
      if (item) choose(Number(item.dataset.index));
    });
  }

  function close({ focus = true } = {}) {
    if (!current) return;
    const { select, menu } = current;
    current = null;
    menu.remove();
    select.classList.remove('is-menu-open');
    if (focus) select.focus({ preventScroll: true });
  }

  function choose(index) {
    if (!current) return;
    const { select } = current;
    const option = select.options[index];
    if (!option || option.disabled) return;
    const changed = select.selectedIndex !== index;
    close();
    if (changed) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  document.addEventListener('mousedown', (event) => {
    if (current && !current.menu.contains(event.target) && event.target !== current.select) close({ focus: false });
    const select = event.target instanceof Element ? event.target.closest('select') : null;
    if (!select || event.button !== 0 || !handles(select)) return;
    event.preventDefault();
    select.focus({ preventScroll: true });
    if (current?.select === select) close();
    else open(select);
  }, true);

  document.addEventListener('keydown', (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || !handles(select)) return;
    const isOpen = current?.select === select;
    const opensMenu = ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key);
    if (!isOpen) {
      if (opensMenu && !event.ctrlKey && !event.metaKey) { event.preventDefault(); open(select); }
      return; // 收起时直接打字：交给系统，照旧直接选中并触发 change
    }
    const options = optionsOf(select);
    const move = (index) => { event.preventDefault(); if (index >= 0) setActive(index); };
    if (event.key === 'ArrowDown') move(logic.step(options, current.active, 1));
    else if (event.key === 'ArrowUp') move(logic.step(options, current.active, -1));
    else if (event.key === 'Home') move(logic.step(options, options.length - 1, 1));
    else if (event.key === 'End') move(logic.step(options, 0, -1));
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(current.active); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') close({ focus: false });
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      current.typed = now - current.typedAt > 700 ? event.key : current.typed + event.key;
      current.typedAt = now;
      const hit = logic.typeahead(options, current.typed);
      if (hit >= 0) setActive(hit);
    }
  }, true);

  // 页面滚动或窗口变化时菜单会和下拉脱开：直接收起（菜单自己内部滚动不算）
  document.addEventListener('scroll', (event) => {
    if (current && !(event.target instanceof Node && current.menu.contains(event.target))) close({ focus: false });
  }, true);
  window.addEventListener('resize', () => close({ focus: false }));
  window.addEventListener('blur', () => close({ focus: false }));
}());
