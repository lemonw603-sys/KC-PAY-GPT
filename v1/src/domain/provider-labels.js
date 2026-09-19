/**
 * 卡台显示名的唯一来源。
 *
 * Lemon 2026-09-20 定：两台都用简称 —— **HNSKJ** 与 **highvcc**，不带「卡台」后缀。
 * （原先工作台用简称、卡片页用全称「HNSKJ 卡台 / highvcc卡台」，同一台卡台两个叫法，
 * 是 2026-09-20 跨页一致性摸排查出来的第 5 条。）
 *
 * 注意 backup-a 在库里的 provider_code 是 `manual_excel`（它走导入表那条入库路径），
 * 实际卡台是 highvcc —— 页面只说 highvcc，不暴露 manual_excel 这个内部代号。
 */
export const PROVIDER_LABELS = Object.freeze({
  hnskj: 'HNSKJ',
  manual_excel: 'highvcc'
});

export function providerLabelOf(providerCode) {
  return PROVIDER_LABELS[String(providerCode || '')] || String(providerCode || '') || '未知卡台';
}
