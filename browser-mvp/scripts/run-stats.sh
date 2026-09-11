#!/usr/bin/env bash
# 只读：把每一次 Browser 真单摊成一行，并给出汇总成功率。不写任何东西。
#   browser-mvp/scripts/run-stats.sh            # 最近 30 次
#   browser-mvp/scripts/run-stats.sh 100        # 最近 100 次
# 数据全部来自系统自己落的库（browser_runs / browser_operations / orders / cards），
# 不需要任何人事先登记：跑过就有，不跑就没有。
# SQL 里一律用英文别名——生产 mysql 客户端未设 utf8mb4，中文别名会被截断成语法错误。
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; Q="$DIR/prod-query.sh"
LIMIT="${1:-30}"
case "$LIMIT" in ''|*[!0-9]*) echo "用法: $0 [条数]" >&2; exit 2 ;; esac

echo "== 逐单明细（最近 $LIMIT 次，时间为 UTC）=="
bash "$Q" "
SELECT
  DATE_FORMAT(r.created_at,'%m-%d %H:%i') AS a,
  IFNULL(o.public_no,'-') AS b,
  IFNULL(c.last4,'-') AS d,
  CASE
    WHEN r.plus_activated_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_operations mo WHERE mo.browser_run_id=r.id AND mo.operation_type LIKE 'MANUAL%') THEN 'OK-auto'
    WHEN o.status='RECHARGE_SUCCESS'                THEN 'OK-manual'
    WHEN r.payment_state='PAYMENT_DECLINED'         THEN 'declined'
    WHEN r.payment_state='PAYMENT_UNKNOWN'          THEN 'pay-unknown'
    WHEN r.last_checkpoint_kind='PRE_PAYMENT_ABORT' THEN 'abort-pre-pay'
    ELSE IFNULL(r.status,'-') END AS e,
  IFNULL(r.last_error_code,'-') AS f,
  (SELECT COUNT(*) FROM browser_operations bo
     WHERE bo.browser_run_id=r.id AND bo.operation_type='PAYMENT_SUBMIT') AS g,
  IF(r.plus_activated_at IS NULL,'-','Y') AS h,
  IF(r.cancellation_confirmed_at IS NULL,'-','Y') AS i,
  TIMESTAMPDIFF(SECOND, r.created_at, IFNULL(r.finished_at, r.updated_at)) AS j
FROM browser_runs r
LEFT JOIN recharge_attempts ra ON ra.id=r.recharge_attempt_id
LEFT JOIN orders o             ON o.id=ra.order_id
LEFT JOIN card_assignment_history ch ON ch.order_id=o.id
LEFT JOIN cards c              ON c.id=ch.card_id
ORDER BY r.created_at DESC
LIMIT $LIMIT" | awk -F'\t' '
BEGIN{printf "%-12s %-27s %-5s %-14s %-26s %-5s %-5s %-6s %s\n","开始","订单","卡","结果","原因","点付款","Plus","已退订","用时秒"}
{printf "%-12s %-27s %-5s %-14s %-26s %-5s %-5s %-6s %s\n",$1,$2,$3,$4,$5,$6,$7,$8,$9}'

echo
echo "== 汇总（全部历史）=="
bash "$Q" "
SELECT COUNT(*) AS a,
  SUM(r.plus_activated_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_operations mo WHERE mo.browser_run_id=r.id AND mo.operation_type LIKE 'MANUAL%')) AS b,
  SUM(IFNULL(r.last_checkpoint_kind,'')='PRE_PAYMENT_ABORT') AS c,
  SUM(EXISTS(SELECT 1 FROM browser_operations bo
        WHERE bo.browser_run_id=r.id AND bo.operation_type='PAYMENT_SUBMIT')) AS d,
  SUM(r.cancellation_confirmed_at IS NOT NULL) AS e
FROM browser_runs r
LEFT JOIN recharge_attempts ra ON ra.id=r.recharge_attempt_id
LEFT JOIN orders o             ON o.id=ra.order_id" |
awk -F'\t' '{printf "总运行=%s  系统自动成功=%s  付款前中止=%s  点过付款=%s  已自动退订=%s\n",$1,$2,$3,$4,$5;
 if ($4+0>0) printf "点过付款的单里【系统自动跑完】的比例 = %.0f%% (%d/%d)\n", $2*100/$4, $2, $4;
 print "注：OK-manual 是人工收口的成功，不计入自动成功；判定依据：系统自己确认过 Plus 生效，且该 run 上没有任何 MANUAL_* 人工操作"}'

echo
echo "== 点过付款后未成功的原因分布 =="
bash "$Q" "
SELECT IFNULL(r.last_error_code,'(none)') AS a, COUNT(*) AS b
FROM browser_runs r
LEFT JOIN recharge_attempts ra ON ra.id=r.recharge_attempt_id
LEFT JOIN orders o ON o.id=ra.order_id
WHERE EXISTS(SELECT 1 FROM browser_operations bo
              WHERE bo.browser_run_id=r.id AND bo.operation_type='PAYMENT_SUBMIT')
  AND NOT (r.plus_activated_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM browser_operations mo WHERE mo.browser_run_id=r.id AND mo.operation_type LIKE 'MANUAL%'))
GROUP BY 1 ORDER BY 2 DESC" | awk -F'\t' '{printf "  %-28s %s\n",$1,$2}'
