#!/usr/bin/env bash
# 客户链路的 SQL 对着生产库实跑一遍，只读。
#
# 为什么需要它：单元测试里 pool 是假的，SQL 字符串从来没被执行过。
# 2026-09-12 就因此漏掉一个致命错误——findStageEvidence 里写了
# browser_operations.created_at，而那张表根本没有这一列（时间列是
# prepared_at / completed_at）。生产上每次查订单状态都会抛错、被 catch
# 吞掉，九阶段整个失效，而 726 项测试全绿。
#
# 用法：v1/scripts/customer-sql-probe.sh
# 前置：SSH 隧道 13306 已起（见 docs/RUNBOOK.md）。
set -uo pipefail
cd "$(dirname "$0")/.."
Q=../browser-mvp/scripts/prod-query.sh
[ -x "$Q" ] || { echo "找不到 $Q" >&2; exit 1; }

fail=0
probe() {
  local name="$1" sql="$2" out
  if out="$("$Q" "$sql" 2>&1)"; then
    case "$out" in
      *ERROR*) printf '[失败] %s\n       %s\n' "$name" "$(printf '%s' "$out" | head -1)"; fail=1 ;;
      *) printf '[通过] %s\n' "$name" ;;
    esac
  else
    printf '[失败] %s\n       %s\n' "$name" "$(printf '%s' "$out" | head -1)"; fail=1
  fi
}

# 取一个真实订单作样本；没有订单时用空串，查询仍然会做语法与列名校验。
OID="$("$Q" "SELECT id FROM orders ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d '\r' | head -1)"

probe "cdk-verify-repository · findCdkForVerification" \
  "SELECT c.id, c.status, c.plan_type, c.order_id, o.id AS internal_order_id, o.public_no,
          o.status AS order_status, product.display_name AS product_name
     FROM cdks c
     LEFT JOIN orders o ON o.id = c.order_id
     LEFT JOIN products product ON product.id = o.product_id
    WHERE (c.hash_version = 'probe' AND c.code_hash = 'probe')
       OR (c.hash_version = 'probe' AND c.code_hash = 'probe')
    LIMIT 2"

probe "customer-stage-repository · browser_run_events" \
  "SELECT action, created_at FROM browser_run_events
    WHERE order_id = '$OID' AND action IS NOT NULL
    ORDER BY created_at ASC, sequence_no ASC LIMIT 200"

probe "customer-stage-repository · browser_operations" \
  "SELECT bo.operation_type, COALESCE(bo.completed_at, bo.prepared_at) AS at
     FROM browser_operations bo
     INNER JOIN browser_runs br ON br.id = bo.browser_run_id
     INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
    WHERE rat.order_id = '$OID'
    ORDER BY bo.id ASC LIMIT 200"

probe "cdk-return-repository · readCdkReturnEvidence" \
  "SELECT (SELECT COUNT(*) FROM recharge_attempts
             WHERE order_id = '$OID' AND (funds_risk_state IN ('UNKNOWN','SETTLED') OR status = 'SUCCESS'))
        + (SELECT COUNT(*) FROM card_consumption_ledger
             WHERE order_id = '$OID' AND status IN ('CONSUMED','RECONCILIATION')) AS funds_evidence,
          (SELECT COUNT(*) FROM browser_operations bo
             INNER JOIN browser_runs br ON br.id = bo.browser_run_id
             INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
            WHERE rat.order_id = '$OID' AND bo.operation_type = 'PAYMENT_SUBMIT') AS submit_evidence"

probe "order-status-query-repository · findCustomerOrder" \
  "SELECT o.public_no, o.status, o.updated_at, o.customer_action_code,
          o.session_replacement_count, o.session_repair_expires_at,
          o.customer_email, o.finished_at, o.id AS internal_order_id,
          o.plan_type, product.product_code, product.display_name AS product_name
     FROM orders o LEFT JOIN products product ON product.id = o.product_id
    WHERE BINARY o.public_no = 'probe' LIMIT 1"

echo
if [ "$fail" -eq 0 ]; then echo "==> 客户链路 SQL 全部可执行 ✓"; else echo "==> 有 SQL 跑不通 ✗"; fi
exit "$fail"
