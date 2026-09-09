#!/usr/bin/env bash
# 充前一键就绪自检：隧道 + mihomo(菲律宾出口) + BitBrowser + 生产服务 + 残留worker。
# 能自动修的（隧道/mihomo）就地拉起；BitBrowser 客户端需人工打开。
HOST=root@144.34.180.184; warn=0; say(){ printf '%s\n' "$*"; }
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
curl -s -m 8 -X POST http://127.0.0.1:54345/health -H 'Content-Type: application/json' -d '{}' 2>/dev/null | grep -q . \
  && say "[OK]  BitBrowser 本地API" || { say "[需操作] 打开比特浏览器客户端"; warn=1; }
svc=$(ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" 'systemctl is-active pojia-web pojia-worker 2>/dev/null|tr "\n" " "' 2>/dev/null)
echo "$svc" | grep -q "active active" && say "[OK]  生产服务 $svc" || { say "[警告] 生产服务 $svc"; warn=1; }
pgrep -f production-live-pool-worker >/dev/null && { say "[警告] 有残留 worker 在跑"; } || say "[OK]  无残留 worker"
say ""; [ $warn -eq 0 ] && say "==> 全部就绪 ✓" || say "==> 有项待处理（见上），处理后再拉 worker"
