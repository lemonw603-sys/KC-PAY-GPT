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
  "SELECT action, JSON_UNQUOTE(JSON_EXTRACT(summary_json, '$.stage')) AS payment_stage, created_at FROM browser_run_events
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

# 状态查询用仓库里导出的那一份 SQL，不在这里另抄——09-26 发现这里的手抄版漏了批 A 的两处改动（D-389）。
ORDER_SQL="$(node --input-type=module -e "import { SELECT_ORDER } from './src/db/repositories/order-status-query-repository.js'; process.stdout.write(SELECT_ORDER)")" \
  || { echo "[失败] 读不到 SELECT_ORDER"; exit 1; }
probe "order-status-query-repository · findCustomerOrder（按查询码）" \
  "$ORDER_SQL WHERE BINARY o.public_no = 'probe' LIMIT 1"
probe "order-status-query-repository · findCustomerOrder（按卡密）" \
  "$ORDER_SQL INNER JOIN cdks c ON c.id = o.cdk_id
    WHERE (c.hash_version = 'probe' AND c.code_hash = 'probe') OR (c.hash_version = 'probe' AND c.code_hash = 'probe')
    ORDER BY (o.id = c.order_id) DESC, o.created_at DESC, o.id DESC LIMIT 1"
probe "order-status-query-repository · findCustomerOrder（真实订单）" \
  "$ORDER_SQL WHERE o.id = '$OID' LIMIT 1"

# 巡检「付款前挂住」与「订单结束收掉卡住告警」（D-390）：同样取仓库导出的那一份；UPDATE 按只读 SELECT 形式跑。
STUCK_SQL="$(node --input-type=module -e "import { PRE_PAYMENT_STUCK_SQL } from './src/db/repositories/stalled-order-queries.js'; process.stdout.write(PRE_PAYMENT_STUCK_SQL.replaceAll('?', '3'))")" \
  || { echo "[失败] 读不到 PRE_PAYMENT_STUCK_SQL"; exit 1; }
probe "stalled-order-queries · 付款前挂住" "$STUCK_SQL"
RESOLVE_SELECT="$(node --input-type=module -e "import { RESOLVE_FINISHED_STALLED_SQL as s } from './src/db/repositories/stalled-order-queries.js'; process.stdout.write('SELECT oa.id FROM operator_alerts oa INNER JOIN orders o ON o.id = oa.order_id ' + s.slice(s.indexOf('WHERE')))")" \
  || { echo "[失败] 读不到 RESOLVE_FINISHED_STALLED_SQL"; exit 1; }
probe "stalled-order-queries · 订单结束收掉卡住告警（只读形式）" "$RESOLVE_SELECT"
FINISHED_ALERTS_SELECT="$(node --input-type=module -e "import { resolveFinishedOrderAlertsSql } from './src/db/repositories/stalled-order-queries.js'; const s = resolveFinishedOrderAlertsSql(); process.stdout.write('SELECT oa.id FROM operator_alerts oa INNER JOIN orders o ON o.id = oa.order_id ' + s.slice(s.indexOf('WHERE')))")" \
  || { echo "[失败] 读不到 resolveFinishedOrderAlertsSql"; exit 1; }
probe "stalled-order-queries · 订单结束收掉失败 / 要人工提醒（只读形式）" "$FINISHED_ALERTS_SELECT"
# D-414 补记十一：API 单停在提交中 / 充值处理中太久（巡检每分钟跑），及订单离开这两态时收掉提醒（只读形式）。
API_STUCK_SQL="$(node --input-type=module -e "import { API_PROCESSING_STUCK_SQL } from './src/db/repositories/stalled-order-queries.js'; process.stdout.write(API_PROCESSING_STUCK_SQL.replaceAll('?', '2'))")" \
  || { echo "[失败] 读不到 API_PROCESSING_STUCK_SQL"; exit 1; }
probe "stalled-order-queries · API 单处理太久" "$API_STUCK_SQL"
API_RESOLVE_SELECT="$(node --input-type=module -e "import { RESOLVE_API_STALLED_SQL as s } from './src/db/repositories/stalled-order-queries.js'; process.stdout.write('SELECT oa.id FROM operator_alerts oa INNER JOIN orders o ON o.id = oa.order_id ' + s.slice(s.indexOf('WHERE')))")" \
  || { echo "[失败] 读不到 RESOLVE_API_STALLED_SQL"; exit 1; }
probe "stalled-order-queries · API 单离开处理中收掉提醒（只读形式）" "$API_RESOLVE_SELECT"
# D-409：「充值成功」推送（巡检每分钟跑）与调度器两条卡查询。UPDATE 改成同条件的 SELECT；带 ? 的填 highvcc × Plus 实值。
SUCCESS_SELECT="$(node --input-type=module -e "import { newlySucceededOrdersSql } from './src/db/repositories/order-success-push.js'; process.stdout.write(newlySucceededOrdersSql())")" \
  || { echo "[失败] 读不到 newlySucceededOrdersSql"; exit 1; }
probe "order-success-push · 刚成功的单（开「充值成功」推送）" "$SUCCESS_SELECT"
SUCCESS_RESOLVE_SELECT="$(node --input-type=module -e "import { resolveDeliveredSuccessAlertsSql } from './src/db/repositories/order-success-push.js'; const s = resolveDeliveredSuccessAlertsSql(); process.stdout.write('SELECT succ_oa.id FROM operator_alerts succ_oa ' + s.slice(s.indexOf('WHERE')))")" \
  || { echo "[失败] 读不到 resolveDeliveredSuccessAlertsSql"; exit 1; }
probe "order-success-push · 推完的成功提醒收掉（只读形式）" "$SUCCESS_RESOLVE_SELECT"
CARD_SQL_WITH_IDS() { node --input-type=module -e "import * as m from './src/services/card-supply-scheduler-service.js'; process.stdout.write(m['$1'].replace('?', \"'00000000-0000-4000-8000-000000000103'\").replace('?', \"'00000000-0000-4000-8000-000000000201'\"))"; }
probe "card-supply-scheduler · 进行中订单占着的卡数" "$(CARD_SQL_WITH_IDS RESERVED_CARDS_SQL)"
probe "card-supply-scheduler · 刚用掉的卡尾号" "$(CARD_SQL_WITH_IDS JUST_USED_CARD_SQL)"
# D-411：分卡 / 水位 / 巡检 / 待销都读 card_top_ups。迁移 063 没跑时这几条会失败——发布顺序是 migrate 在 probe 之前。
ELIG_SQL() { node --input-type=module -e "import * as m from './src/services/card-inventory-eligibility.js'; process.stdout.write($1)"; }
probe "card-inventory-eligibility · 分卡资格（含补钱未了结 TOP_UP_PENDING）" \
  "SELECT COUNT(*) FROM cards WHERE $(ELIG_SQL "m.eligibleInventoryCardSql('cards', '16')")"
probe "card-inventory-eligibility · 能服务下一单的卡数（含可补钱旧卡，调度器 / 切换 / 巡检同一口径）" \
  "SELECT COUNT(*) FROM cards WHERE provider_account_id = '00000000-0000-4000-8000-000000000103' AND $(ELIG_SQL "m.usableCardSql('cards', m.minimumBalanceSql('plus'), { productCode: 'plus' })")"
probe "card-retirement · 待销候选（可补钱旧卡不算 DEPLETED）" \
  "$(node --input-type=module -e "import { retirementCandidateSql } from './src/services/card-retirement-service.js'; process.stdout.write(retirementCandidateSql())") LIMIT 1"

echo
if [ "$fail" -eq 0 ]; then echo "==> 客户链路 SQL 全部可执行 ✓"; else echo "==> 有 SQL 跑不通 ✗"; fi
exit "$fail"
