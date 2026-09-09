#!/usr/bin/env bash
# 充前一键就绪自检：隧道 + mihomo(菲律宾出口) + BitBrowser + 生产服务 + 残留worker + DB(付款开关/账号槽)。
# 能自动修的（隧道/mihomo）就地拉起；BitBrowser 客户端需人工打开。
#   ready-check.sh            # 只体检
#   ready-check.sh rehearsal  # 额外要求付款开关=false
#   ready-check.sh pay        # 额外要求付款开关=true
HOST=root@144.34.180.184; warn=0; MODE="${1:-}"; say(){ printf '%s\n' "$*"; }
DIR="$(cd "$(dirname "$0")" && pwd)"
if nc -z 127.0.0.1 13306 2>/dev/null; then say "[OK]  SSH隧道 13306"; else
  ssh -f -N -o BatchMode=yes -o ExitOnForwardFailure=yes -L 13306:127.0.0.1:3306 "$HOST" 2>/dev/null; sleep 2
  nc -z 127.0.0.1 13306 2>/dev/null && say "[修复] 隧道已重开" || { say "[失败] 隧道起不来"; warn=1; }
fi
if lsof -nP -iTCP:17897 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then say "[OK]  mihomo 17897 监听"; else
  launchctl kickstart -k "gui/$(id -u)/com.pojia.mihomo-ph" 2>/dev/null; sleep 3
  lsof -nP -iTCP:17897 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN && say "[修复] mihomo 已拉起" || { say "[失败] mihomo 起不来"; warn=1; }
fi
OUT=$(curl -s --proxy http://127.0.0.1:17897 -m 15 https://api.ipify.org 2>/dev/null)
[ "$OUT" = "38.60.246.34" ] && say "[OK]  出口=菲律宾 $OUT" || { say "[警告] 出口=$OUT 非预期菲律宾IP"; warn=1; }
bb(){ curl -s -m 6 -X POST http://127.0.0.1:54345/health -H 'Content-Type: application/json' -d '{}' 2>/dev/null | grep -q .; }
if bb; then say "[OK]  BitBrowser 本地API"; else
  open "/Applications/比特浏览器.app" 2>/dev/null || open -a "比特浏览器" 2>/dev/null
  for i in 1 2 3 4 5 6 7 8 9; do sleep 5; bb && break; done
  bb && say "[修复] 比特浏览器已自动启动" || { say "[需操作] 比特浏览器起不来（可能停在登录页）"; warn=1; }
fi
svc=$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" 'systemctl is-active pojia-web pojia-worker 2>/dev/null|tr "\n" " "' 2>/dev/null)
echo "$svc" | grep -q "active active" && say "[OK]  生产服务 $svc" || { say "[警告] 生产服务 $svc"; warn=1; }
pgrep -f production-live-pool-worker >/dev/null && say "[警告] 有残留 worker 在跑" || say "[OK]  无残留 worker"
if nc -z 127.0.0.1 13306 2>/dev/null; then
  PAY=$("$DIR/prod-query.sh" "SELECT setting_value FROM app_settings WHERE setting_key='browser_payment_writes_enabled'" 2>/dev/null | tr -d '[:space:]')
  RUNS=$("$DIR/prod-query.sh" "SELECT COUNT(*) FROM browser_runs WHERE active_account_key_hmac IS NOT NULL" 2>/dev/null | tr -d '[:space:]')
  say "[信息] 付款开关=${PAY:-?}（预检/rehearsal 需 false；真付需 true）"
  [ "$RUNS" = "0" ] && say "[OK]  账号槽空闲 active_runs=0" || { say "[警告] active_runs=${RUNS}（可能卡 RUN_NOT_ACTIONABLE）"; warn=1; }
  if [ "$MODE" = rehearsal ] && [ "$PAY" != "false" ]; then say "[阻断] rehearsal/预检要求付款开关=false，当前=$PAY"; warn=1; fi
  if [ "$MODE" = pay ] && [ "$PAY" != "true" ]; then say "[阻断] 真付要求付款开关=true，当前=$PAY"; warn=1; fi
fi
say ""; [ $warn -eq 0 ] && say "==> 全部就绪 ✓${MODE:+ ($MODE)}" || say "==> 有项待处理（见上），处理后再拉 worker"
