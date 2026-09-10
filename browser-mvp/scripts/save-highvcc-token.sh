#!/usr/bin/env bash
# 把剪贴板里的舜捷 access_token 存进本机 0600 文件，不回显内容，存完清空剪贴板。
#   在登录着 highvcc.com 的 Chrome 里按 F12 → Console，粘贴并回车：
#     copy(localStorage.getItem('access_token'))
#   然后在终端跑：browser-mvp/scripts/save-highvcc-token.sh
#   要存 refresh_token 时：copy(localStorage.getItem('refresh_token')) 后跑 ... save-highvcc-token.sh refresh
set -euo pipefail
KIND="${1:-access}"; case "$KIND" in access|refresh) ;; *) echo "usage: $0 [access|refresh]" >&2; exit 2 ;; esac
DIR="$HOME/Library/Application Support/AI充值业务"; FILE="$DIR/highvcc.env"; KEY="HIGHVCC_$(echo "$KIND" | tr a-z A-Z)_TOKEN"
mkdir -p "$DIR"; chmod 700 "$DIR"
VALUE="$(pbpaste | tr -d '\r\n' | sed 's/^"//; s/"$//')"
LEN=${#VALUE}
if [ "$LEN" -lt 16 ] || [ "$LEN" -gt 4096 ] || printf '%s' "$VALUE" | grep -q '[[:space:]]'; then
  echo "clipboard does not look like a token (length $LEN); copy it again" >&2; exit 1
fi
touch "$FILE"; chmod 600 "$FILE"
{ grep -v "^$KEY=" "$FILE" 2>/dev/null || true; printf '%s=%s\n' "$KEY" "$VALUE"; } > "$FILE.tmp"
chmod 600 "$FILE.tmp"; mv "$FILE.tmp" "$FILE"
pbcopy < /dev/null
echo "saved $KEY (length $LEN) to $FILE; clipboard cleared"
