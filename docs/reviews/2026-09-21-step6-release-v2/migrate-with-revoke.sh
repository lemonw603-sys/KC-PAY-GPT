#!/usr/bin/env bash
# Server-side wrapper for the exact two migration-runner calls used by
# deploy-release.sh migrate. Keep temporary grant and mandatory revocation in
# the same EXIT trap; no application data SQL is written here.
set -euo pipefail
release=/opt/pojia/releases/20260921-step6-9b9f181
checkpoint=/opt/pojia/maintenance/20260921-step6-9b9f181
[[ -f "$checkpoint/snapshot.json" && -f "$release/v1/scripts/migrate.js" ]]
root_sql() {
  docker exec -i pojia-mysql sh -c 'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -uroot --batch --skip-column-names'
}
for unit in pojia-web.service pojia-worker.service pojia-bark-notifications.service; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == inactive ]] || { echo "must_stop=$unit"; exit 1; }
done
[[ $(root_sql <<<"SELECT Super_priv FROM mysql.user WHERE User='pojia_migrator' AND Host='172.17.0.1'") == N ]] || { echo unexpected_original_super; exit 1; }
must_revoke=0
revoke_added_super() {
  [[ $must_revoke == 1 ]] || return 0
  local present
  present=$(root_sql <<<"SELECT Super_priv FROM mysql.user WHERE User='pojia_migrator' AND Host='172.17.0.1'") || return 1
  if [[ $present == Y ]]; then
    root_sql <<<"REVOKE SUPER ON *.* FROM 'pojia_migrator'@'172.17.0.1';" || return 1
  elif [[ $present != N ]]; then return 1; fi
  [[ $(root_sql <<<"SELECT Super_priv FROM mysql.user WHERE User='pojia_migrator' AND Host='172.17.0.1'") == N ]] || return 1
  must_revoke=0
  echo temporary_super_revoked_and_verified
}
trap 'result=$?; revoke_added_super || { echo CRITICAL_SUPER_REVOKE_FAILED >&2; exit 90; }; exit "$result"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
must_revoke=1
root_sql <<<"GRANT SUPER ON *.* TO 'pojia_migrator'@'172.17.0.1';"
echo temporary_super_granted
cd "$release/v1"
set -a; . /etc/pojia/migration.env; set +a
npm run migrate --silent
echo '-- second pass --'
npm run migrate --silent
revoke_added_super
root_sql <<'SQL'
SHOW GRANTS FOR 'pojia_migrator'@'172.17.0.1';
SELECT version FROM pojia.schema_migrations ORDER BY version DESC LIMIT 3;
SELECT TRIGGER_NAME,DEFINER FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='pojia';
SELECT @@log_bin,@@log_bin_trust_function_creators;
SQL
