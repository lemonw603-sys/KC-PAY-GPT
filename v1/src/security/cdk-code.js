import crypto from 'node:crypto';

export const LEGACY_CDK_HASH_VERSION = 'sha256-v1';
export const CURRENT_CDK_HASH_VERSION = 'hmac-sha256-v1';
// New codes are grouped for readability; the original ungrouped format remains redeemable.
//
// D-279 ②：前缀按产品分开（PLUS- / 5X- / 20X-），旧的统一前缀 PJ- 必须继续收——
// 库里已有大量 PJ- 码在客户手上，正则收窄会让它们**导入即非法**。
// 注意客户兑换那条路不看前缀（order-intake-service 的 normalizeCdk 只校验长度、再按哈希查），
// 所以这个正则只管两件事：后台生成出来的码长什么样、导入批次时哪些行算合法。
export const CDK_CODE_PREFIXES = Object.freeze(['PLUS-', '5X-', '20X-', 'PJ-']);
const PREFIX_ALTERNATION = CDK_CODE_PREFIXES
  .map((prefix) => prefix.replace(/[-]/g, '\\-'))
  .join('|');
export const GENERATED_CDK_PATTERN = new RegExp(
  `^(?:${PREFIX_ALTERNATION})(?:[A-HJ-KM-NP-Z2-9]{20}|[A-HJ-KM-NP-Z2-9]{5}(?:-[A-HJ-KM-NP-Z2-9]{5}){3})$`
);

function assertHashKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('CDK hash key must be exactly 32 bytes');
  }
}

export function hashLegacyCdk(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

export function hashCurrentCdk(code, key) {
  assertHashKey(key);
  return crypto.createHmac('sha256', key).update(String(code), 'utf8').digest('hex');
}

export function createCdkLookup(code, key) {
  return {
    current: { version: CURRENT_CDK_HASH_VERSION, hash: hashCurrentCdk(code, key) },
    legacy: { version: LEGACY_CDK_HASH_VERSION, hash: hashLegacyCdk(code) }
  };
}
