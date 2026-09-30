/**
 * 「这张卡被成功扣过款」的唯一口径（2026-09-27 整体排查后收拢）。
 *
 * 状态值按生产 card_transactions 实际出现过的：highvcc 原样存 COMPLETE（成功）/ DECLINED / PENDING，
 * hnskj 存 success / SUCCESS / SETTLED（成功）/ failed。以前自动放卡只认 LOWER(status)='success'，
 * highvcc 的 COMPLETE 不算扣款——口径只会往严里收：认不出的状态一律不算「成功」，也不因此放卡，
 * 放卡另有余额与时间条件把关。
 *
 * 用它的地方（改口径一起改）：失败单卡流水同步后的自动放卡（card-transaction-repository）、
 * 后台「放卡退卡密」（api-failure-release-service）、每周自检的账外扣款（weekly-readonly-probe）。
 */
// 定义已挪到 services/card-inventory-eligibility.js（那个文件必须自成一体，现场比对脚本只拷它一个文件加载）；
// 这里转引，原有引用路径不变。
export { SUCCESSFUL_PURCHASE_STATUSES, successfulPurchaseSql } from '../services/card-inventory-eligibility.js';
