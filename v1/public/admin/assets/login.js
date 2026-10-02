// 卡台 token 的中转站：书签把 token 放在 /admin 的 #hash 里，但未登录时服务器会 302 到
// /admin/login，浏览器把 fragment 带到了这一页——而这一页原本完全不认识它，登录成功后
// replace('/admin') 又不带 hash，token 就此丢失。2026-09-12 之前书签一直失灵就是这个原因
// （第一次修错了地方：加在 admin.js 里，而这条路上 admin.js 根本没被加载过）。
// 这里把它接住存进 sessionStorage，登录回到 /admin 后由 admin.js 完成保存。
// 同源同标签页，sessionStorage 跨这次导航有效；URL 立刻清掉，token 不留在地址栏和历史里。
(function stashHighvccTokenFromHash() {
  const match = /(?:^|[#&])highvcc-token=([^&]+)/.exec(location.hash);
  if (!match) return;
  try { sessionStorage.setItem('highvcc-token-pending', decodeURIComponent(match[1])); } catch { /* 存不了就只能这次失败 */ }
  history.replaceState(null, '', location.pathname + location.search);
})();

// 会话其实还有效，却被送到了这一页（D-414 补记十三第 4 条）：书签是在 highvcc.com 上发起的跳转，
// 属于跨站导航；会话 cookie 是 SameSite=Strict，浏览器不随这次请求发出，服务器只能当未登录 302 过来。
// 本页自己发的同源请求会带上它，所以手里有待存的 token 时先问一次会话：还有效就直接回 /admin，
// 由 admin.js 既有流程完成保存，不再让人重输密码。会话无效、问不通，照旧显示登录表单。
// 只读：这次请求不带 token、不改 cookie；服务器的门禁和 SameSite 都不动。
// 防打转：回 /admin 前记一笔时间；如果 30 秒内又被弹回这一页（说明 /admin 仍不认这个会话），
// 就不再自动跳，留在登录表单。
(async function resumeSessionForPendingHighvccToken() {
  const RESUME_MARK = 'admin-session-resume-at';
  let pending = false;
  let bouncedBack = false;
  try {
    pending = Boolean(sessionStorage.getItem('highvcc-token-pending'));
    const mark = Number(sessionStorage.getItem(RESUME_MARK));
    sessionStorage.removeItem(RESUME_MARK);
    bouncedBack = mark > 0 && Date.now() - mark < 30 * 1000;
  } catch { return; }
  if (!pending || bouncedBack) return;
  try {
    const response = await fetch('/api/v1/admin/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json().catch(() => null);
    if (payload?.authenticated !== true) return;
    try { sessionStorage.setItem(RESUME_MARK, String(Date.now())); } catch { return; }
    window.location.replace('/admin');
  } catch { /* 问不通就照旧登录 */ }
})();

const form = document.querySelector('#login-form');
const password = document.querySelector('#password');
const button = document.querySelector('#login-button');
const notice = document.querySelector('#login-notice');

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  notice.focus();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  notice.hidden = true;
  if (password.value.length < 12) return showNotice('请输入完整的后台密码。');
  button.disabled = true;
  button.textContent = '正在登录…';
  try {
    const response = await fetch('/api/v1/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value })
    });
    password.value = '';
    if (response.status === 204) {
      window.location.replace('/admin');
      return;
    }
    const payload = await response.json().catch(() => ({}));
    if (payload.error === 'admin_not_configured') return showNotice('后台登录尚未配置，请先完成服务器配置。');
    if (response.status === 429) return showNotice('尝试次数过多，请稍后再试。');
    showNotice('密码不正确，请重新输入。');
  } catch {
    showNotice('暂时无法连接服务，请稍后重试。');
  } finally {
    button.disabled = false;
    button.textContent = '登录后台 →';
  }
});
