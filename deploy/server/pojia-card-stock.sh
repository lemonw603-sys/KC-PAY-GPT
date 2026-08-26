#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo 'pojia-card-stock must run as root' >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo 'usage: pojia-card-stock <status|threshold|register|sync|open> [options]' >&2
  exit 1
fi

set -a
. /etc/pojia/runtime.env
. /etc/pojia/provider.env
set +a

PROVIDER_WRITES_ENABLED=false
export PROVIDER_WRITES_ENABLED
if [ "$1" = 'open' ]; then
  PROVIDER_CARD_WRITES_ENABLED=true
  export PROVIDER_CARD_WRITES_ENABLED
fi

cd /opt/pojia/current/v1
exec node scripts/card-stock.js "$@"
