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
