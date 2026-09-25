import { HIGHVCC_TOKEN_TROUBLE_CODES } from '../domain/highvcc-token-trouble.js';
import { clearProviderTokenExpired } from './card-supply-scheduler-service.js';
import { BACKUP_A_PROVIDER_ACCOUNT_ID } from './highvcc-card-service.js';

/**
 * 后台「贴 token」= 保存 + 当场验证（D-377）。
 *
 * 以前只保存：「token 失效」告警要等下一轮每小时快照同步成功才关，这一小时里告警和工作台 token 格
 * 都还显示失效，贴的人以为没贴上（2026-09-25 实例）。现在保存后马上用新 token 读一次卡台钱包
 * （只读、不花钱）：卡台认 → 关告警；卡台不认或连不上 → 不动告警，开告警、推送仍只由每小时同步判定
 * （一段失效期只推一次的规则不变）。token 已经存下了，验证结果只用来告诉贴的人，不回滚保存。
 *
 * 只在网页后台进程里组装（server.js）；highvcc-card-service 本身不动，因为它在本机付款池的加载范围内。
 */
export function createHighvccTokenSaveService({ pool, setToken, walletStatus, verifyTimeoutMs = 10_000 } = {}) {
  if (!pool?.query) throw new TypeError('pool is required');
  if (typeof setToken !== 'function' || typeof walletStatus !== 'function') throw new TypeError('setToken and walletStatus are required');

  async function verify() {
    let timer;
    try {
      await Promise.race([
        walletStatus(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('token verification timed out')), verifyTimeoutMs); }),
      ]);
    } catch (error) {
      return { verification: HIGHVCC_TOKEN_TROUBLE_CODES.has(error?.code) ? 'REJECTED' : 'UNKNOWN', alertCleared: false };
    } finally {
      clearTimeout(timer);
    }
    try {
      await clearProviderTokenExpired(pool, { providerAccountId: BACKUP_A_PROVIDER_ACCOUNT_ID });
      return { verification: 'VALID', alertCleared: true };
    } catch {
      return { verification: 'VALID', alertCleared: false };
    }
  }

  return async function saveHighvccToken({ token, requestedBy } = {}) {
    const saved = await setToken({ token, requestedBy }); // 格式不对等错误原样抛出，路由层按原样处理
    return { ...saved, ...(await verify()) };
  };
}
