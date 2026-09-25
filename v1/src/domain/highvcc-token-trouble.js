/**
 * highvcc provider（providers/highvcc-card.js）在「token 不能用」时抛的两个码：没配 / 卡台不认。
 * 每小时快照同步据此开 token 失效告警，贴 token 后的当场验证据此判「卡台不认」（D-377）——同一份，不各抄一份。
 * 放在 domain 而不是 provider 文件里：provider 在本机付款池的加载范围内，这里不在。
 */
export const HIGHVCC_TOKEN_TROUBLE_CODES = new Set(['HIGHVCC_TOKEN_EXPIRED', 'HIGHVCC_TOKEN_MISSING']);
