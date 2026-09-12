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
