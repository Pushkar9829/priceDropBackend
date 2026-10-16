#!/usr/bin/env bash
# One-shot setup for the droppingnow backend on a fresh Ubuntu 24.04 EC2 server.
# Run on the server:   bash ~/ec2-setup.sh
# It asks for the Atlas connection string (to copy the pricecompare data) and does the rest.
# MongoDB has no password but listens on 127.0.0.1 only (never open port 27017 in AWS).
set -euo pipefail

DOMAIN="api.droppingnow.com"
APP_DIR="$HOME/backend"
DB_URI="mongodb://127.0.0.1:27017/pricecompare"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

[ -f "$HOME/backend.tgz" ] || { echo "Upload backend.tgz to $HOME first (see the guide)."; exit 1; }
read -rp "Atlas connection string for the pricecompare database (or leave empty to skip the copy): " ATLAS_URI
if [ -n "$ATLAS_URI" ] && [[ "$ATLAS_URI" != *"/pricecompare"* ]]; then
  echo "Refusing: the Atlas URI must point at the /pricecompare database (never price_comparison)."; exit 1
fi

step "System update"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade

step "Swap (4 GB)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

step "Node 22, Nginx, Git, Certbot, PM2"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
fi
sudo apt-get install -y nodejs nginx git certbot python3-certbot-nginx
command -v pm2 >/dev/null || sudo npm install -g pm2

step "MongoDB 8 (local only, no password)"
if ! command -v mongod >/dev/null; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
  sudo apt-get update -y
  sudo apt-get install -y mongodb-org mongodb-database-tools
fi
sudo tee /etc/mongod.conf >/dev/null <<'EOF'
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 0.25
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log
net:
  port: 27017
  bindIp: 127.0.0.1
processManagement:
  timeZoneInfo: /usr/share/zoneinfo
EOF
sudo systemctl enable mongod
sudo systemctl restart mongod
for i in $(seq 1 30); do mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && break; sleep 1; done

if [ -n "$ATLAS_URI" ]; then
  step "Copy pricecompare data from Atlas"
  rm -rf /tmp/pcdump
  mongodump --uri="$ATLAS_URI" --out=/tmp/pcdump
  mongorestore --uri="$DB_URI" --nsInclude="pricecompare.*" --drop /tmp/pcdump
  rm -rf /tmp/pcdump
fi
mongosh --quiet pricecompare --eval 'printjson({products: db.products.countDocuments(), users: db.users.countDocuments()})'

step "Backend code + packages"
mkdir -p "$APP_DIR"
tar -xzf "$HOME/backend.tgz" -C "$APP_DIR"
cd "$APP_DIR"
npm ci --omit=dev

step "Chromium for the price checks"
sudo npx --yes playwright install-deps chromium
npx --yes playwright install chromium

step "Production settings (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  cat >"$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=5000
API_PREFIX=/api/v1
WEB_CONCURRENCY=1
TRUST_PROXY=1
LOG_LEVEL=info
MONGODB_URI=$DB_URI
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://www.droppingnow.com,https://droppingnow.com
SITE_URL=https://www.droppingnow.com
CUELINKS_CID=279120
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=600
ENABLE_CRON=true
PRICE_MONITOR_CRON=*/5 * * * *
MONITOR_HOT_INTERVAL_MIN=30
MONITOR_NORMAL_INTERVAL_MIN=240
MONITOR_COLD_INTERVAL_MIN=720
MONITOR_BATCH_SIZE=100
MONITOR_TICK_BUDGET_SEC=240
MONITOR_PER_STORE_CONCURRENCY=1
MONITOR_PER_STORE_DELAY_MS=1500
CRON_SECRET=$(openssl rand -hex 24)
SCRAPER_MODE=http
SCRAPER_ENABLE_PLAYWRIGHT=true
SCRAPER_TIMEOUT_MS=45000
SCRAPER_MAX_RETRIES=2
SCRAPER_CONCURRENCY=1
EOF
  chmod 600 "$APP_DIR/.env"
else
  echo ".env already exists — kept as is"
fi

step "Start with PM2 (auto-start on reboot)"
pm2 describe droppingnow-api >/dev/null 2>&1 && pm2 reload droppingnow-api || pm2 start npm --name droppingnow-api -- start
pm2 save
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null
for i in $(seq 1 30); do curl -fs http://127.0.0.1:5000/api/v1/health >/dev/null && break; sleep 2; done
curl -s http://127.0.0.1:5000/api/v1/health; echo

step "Nginx for $DOMAIN"
sudo tee /etc/nginx/sites-available/droppingnow >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/droppingnow /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

step "Nightly database backup (last 7 days kept in ~/backups)"
mkdir -p "$HOME/backups"
( crontab -l 2>/dev/null | grep -v 'droppingnow-backup' ; echo "0 3 * * * mongodump --uri=\"$DB_URI\" --archive=$HOME/backups/pricecompare-\$(date +\%a).gz --gzip # droppingnow-backup" ) | crontab -

step "Done"
echo "Backend is running on this server."
echo "Next: point DNS 'api' A record at this server's IP, then run:"
echo "  sudo certbot --nginx -d $DOMAIN --redirect --agree-tos -m droppingnowapp@gmail.com --no-eff-email"
