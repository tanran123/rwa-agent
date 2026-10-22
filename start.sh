#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
  nvm use 18 >/dev/null
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "还没有 pm2。先执行: npm install -g pm2"
  exit 1
fi

export RWA_NODE="$(command -v node)"
if pm2 describe rwa-api >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs --update-env
fi
pm2 save

plist="$HOME/Library/LaunchAgents/com.rwa.pm2.plist"
pm2_bin="$(command -v pm2)"
node_bin="$(dirname "$pm2_bin")"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.rwa.pm2</string>
  <key>ProgramArguments</key>
  <array>
    <string>${pm2_bin}</string>
    <string>resurrect</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${node_bin}:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PM2_HOME</key>
    <string>${HOME}/.pm2</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.pm2/launchd-out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.pm2/launchd-err.log</string>
</dict>
</plist>
EOF
uid="$(id -u)"
launchctl bootout "gui/${uid}/com.rwa.pm2" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${uid}" "$plist"
pm2 status
