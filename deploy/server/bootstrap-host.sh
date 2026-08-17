#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "bootstrap-host.sh must run as root" >&2
  exit 1
fi

MYSQL_IMAGE='mysql:8.4.11'
MYSQL_CONTAINER='pojia-mysql'
MYSQL_GATEWAY='172.17.0.1'

dnf -y module enable nodejs:22
dnf -y install nodejs

if ! id pojia >/dev/null 2>&1; then
  useradd --system --home-dir /opt/pojia --shell /sbin/nologin pojia
fi

install -d -m 0750 -o root -g pojia /etc/pojia
install -d -m 0755 -o root -g root /opt/pojia /opt/pojia/releases
install -d -m 0700 -o root -g root /var/lib/pojia
install -d -m 0700 -o root -g root /var/lib/pojia/mysql

create_secret() {
  local path=$1
  local format=$2
  if [[ -e ${path} ]]; then
    return
  fi
  umask 077
  if [[ ${format} == hex ]]; then
    openssl rand -hex 32 >"${path}"
  else
    openssl rand -base64 32 >"${path}"
  fi
  chmod 0600 "${path}"
}

create_secret /etc/pojia/mysql-root-password hex
create_secret /etc/pojia/mysql-app-password hex
create_secret /etc/pojia/mysql-migrator-password hex
create_secret /etc/pojia/session-encryption-key base64

if ! docker container inspect "${MYSQL_CONTAINER}" >/dev/null 2>&1; then
  docker run -d \
    --name "${MYSQL_CONTAINER}" \
    --restart unless-stopped \
    --memory 1g \
    --cpus 1.5 \
    --publish 127.0.0.1:3306:3306 \
    --volume /var/lib/pojia/mysql:/var/lib/mysql \
    --volume /etc/pojia/mysql-root-password:/run/secrets/mysql_root_password:ro \
    --env MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql_root_password \
    --env MYSQL_DATABASE=pojia \
    "${MYSQL_IMAGE}" \
    --skip-name-resolve
else
  docker start "${MYSQL_CONTAINER}" >/dev/null
fi

for _ in $(seq 1 90); do
  if docker exec "${MYSQL_CONTAINER}" sh -c \
    'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -uroot -Nse "SELECT 1"' \
    >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! docker exec "${MYSQL_CONTAINER}" sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -uroot -Nse "SELECT 1"' \
  >/dev/null 2>&1; then
  echo "MySQL did not become ready" >&2
  exit 1
fi

app_password=$(tr -d '\n' </etc/pojia/mysql-app-password)
migrator_password=$(tr -d '\n' </etc/pojia/mysql-migrator-password)

docker exec -i "${MYSQL_CONTAINER}" sh -c \
  'MYSQL_PWD="$(cat /run/secrets/mysql_root_password)" mysql -uroot' <<SQL
CREATE DATABASE IF NOT EXISTS pojia CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'pojia_app'@'${MYSQL_GATEWAY}' IDENTIFIED BY '${app_password}';
ALTER USER 'pojia_app'@'${MYSQL_GATEWAY}' IDENTIFIED BY '${app_password}' ACCOUNT UNLOCK;
GRANT SELECT, INSERT, UPDATE, DELETE ON pojia.* TO 'pojia_app'@'${MYSQL_GATEWAY}';
CREATE USER IF NOT EXISTS 'pojia_migrator'@'${MYSQL_GATEWAY}' IDENTIFIED BY '${migrator_password}';
ALTER USER 'pojia_migrator'@'${MYSQL_GATEWAY}' IDENTIFIED BY '${migrator_password}' ACCOUNT UNLOCK;
GRANT ALL PRIVILEGES ON pojia.* TO 'pojia_migrator'@'${MYSQL_GATEWAY}';
FLUSH PRIVILEGES;
SQL

session_key=$(tr -d '\n' </etc/pojia/session-encryption-key)
umask 027
cat >/etc/pojia/runtime.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3100
TRUST_PROXY=true
DATABASE_URL=mysql://pojia_app:${app_password}@127.0.0.1:3306/pojia
DATABASE_TLS=false
SESSION_ENCRYPTION_KEY_BASE64=${session_key}
WORKER_POLL_INTERVAL_MS=1000
WORKER_LEASE_SECONDS=60
PROVIDER_READS_ENABLED=false
PROVIDER_WRITES_ENABLED=false
ZZSHU_API_BASE_URL=https://card.zzshu.pro/api/v1
EOF
chown root:pojia /etc/pojia/runtime.env
chmod 0640 /etc/pojia/runtime.env

cat >/etc/pojia/migration.env <<EOF
NODE_ENV=production
DATABASE_URL=mysql://pojia_app:${app_password}@127.0.0.1:3306/pojia
DATABASE_TLS=false
MIGRATION_DATABASE_URL=mysql://pojia_migrator:${migrator_password}@127.0.0.1:3306/pojia
MIGRATION_DATABASE_TLS=false
EOF
chmod 0600 /etc/pojia/migration.env

echo "host bootstrap complete"
