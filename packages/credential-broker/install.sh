#!/bin/sh
set -eu

PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR='/Library/Application Support/Focx/CredentialBroker'
CONFIG_PATH="$INSTALL_DIR/config.json"
DAEMON_PATH='/Library/LaunchDaemons/ai.focx.credential-broker.plist'
CLIENT_PATH='/usr/local/bin/paperclip'
GIT_CLIENT_PATH='/usr/local/bin/git-credential-focx'
LABEL='ai.focx.credential-broker'
ORIGIN='https://ops.focx.ai:443'
AGENT_USER=''

usage() {
  echo 'usage: sudo ./install.sh --agent-user USER [--origin https://host:port]' >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-user) [ "$#" -ge 2 ] || usage; AGENT_USER=$2; shift 2 ;;
    --origin) [ "$#" -ge 2 ] || usage; ORIGIN=$2; shift 2 ;;
    *) usage ;;
  esac
done

[ "$(/usr/bin/id -u)" -eq 0 ] || { echo 'install must run as root' >&2; exit 2; }
[ -n "$AGENT_USER" ] || usage
AGENT_UID=$(/usr/bin/id -u "$AGENT_USER")
GIT_EXEC_PATH=$(/usr/bin/git --exec-path)
GIT_REMOTE_PATH=$(/usr/bin/readlink "$GIT_EXEC_PATH/git-remote-https" 2>/dev/null || true)
case "$GIT_REMOTE_PATH" in
  /*) ;;
  '') GIT_REMOTE_PATH="$GIT_EXEC_PATH/git-remote-https" ;;
  *) GIT_REMOTE_PATH="$GIT_EXEC_PATH/$GIT_REMOTE_PATH" ;;
esac
GIT_REMOTE_PATH=$(CDPATH= cd -- "$(dirname -- "$GIT_REMOTE_PATH")" && pwd)/$(basename -- "$GIT_REMOTE_PATH")

case "$ORIGIN" in
  https://*:* ) ;;
  *) echo 'origin must be explicit https://host:port' >&2; exit 2 ;;
esac

# Root installation from an agent-writable checkout would make the reviewed
# source vulnerable to a compile-time race. Stage the reviewed commit in a
# root-owned, non-group/other-writable directory first; this check is binding.
SOURCE_COMPONENT=$PACKAGE_DIR
while [ "$SOURCE_COMPONENT" != '/' ]; do
  SOURCE_OWNER=$(/usr/bin/stat -f '%u' "$SOURCE_COMPONENT")
  SOURCE_MODE=$(/usr/bin/stat -f '%Lp' "$SOURCE_COMPONENT")
  [ "$SOURCE_OWNER" -eq 0 ] || { echo "refusing agent-writable source component: $SOURCE_COMPONENT" >&2; exit 3; }
  case "$SOURCE_MODE" in
    *[2367]|*[2367]?) echo "refusing group/other-writable source component: $SOURCE_COMPONENT" >&2; exit 3 ;;
  esac
  SOURCE_COMPONENT=$(dirname -- "$SOURCE_COMPONENT")
done

BUILD_DIR=$(/usr/bin/mktemp -d '/private/var/tmp/focx-credential-broker.XXXXXX')
trap '/bin/rm -rf "$BUILD_DIR"' EXIT HUP INT TERM
FOCX_BROKER_BUILD_DIR="$BUILD_DIR" CLANG_MODULE_CACHE_PATH="$BUILD_DIR/clang-cache" /bin/sh "$PACKAGE_DIR/build.sh" >/dev/null

/bin/mkdir -p "$INSTALL_DIR"
/usr/sbin/chown root:wheel "$INSTALL_DIR"
/bin/chmod 0755 "$INSTALL_DIR"
/usr/bin/install -o root -g wheel -m 0555 "$BUILD_DIR/focx-credential-broker" "$INSTALL_DIR/focx-credential-broker"
/bin/ln -sf "$INSTALL_DIR/focx-credential-broker" "$CLIENT_PATH"
/bin/ln -sf "$INSTALL_DIR/focx-credential-broker" "$GIT_CLIENT_PATH"
/usr/sbin/chown -h root:wheel "$CLIENT_PATH" "$GIT_CLIENT_PATH"

umask 077
CONFIG_TMP="$BUILD_DIR/config.json"
/bin/echo "{\"version\":1,\"paperclipOrigin\":\"$ORIGIN\",\"socketPath\":\"/var/run/focx-credential-broker.sock\",\"agentUid\":$AGENT_UID,\"githubRepository\":\"ryanphillipthomas/focx\",\"gitRemoteHelperPath\":\"$GIT_REMOTE_PATH\"}" > "$CONFIG_TMP"
/usr/bin/install -o root -g wheel -m 0444 "$CONFIG_TMP" "$CONFIG_PATH"

PLIST_TMP="$BUILD_DIR/$LABEL.plist"
/bin/echo '<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.focx.credential-broker</string>
  <key>ProgramArguments</key><array>
    <string>/Library/Application Support/Focx/CredentialBroker/focx-credential-broker</string>
    <string>server</string><string>--config</string>
    <string>/Library/Application Support/Focx/CredentialBroker/config.json</string>
  </array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>/var/log/focx-credential-broker.log</string>
  <key>StandardErrorPath</key><string>/var/log/focx-credential-broker.log</string>
</dict></plist>' > "$PLIST_TMP"
/usr/bin/plutil -lint "$PLIST_TMP" >/dev/null
/usr/bin/install -o root -g wheel -m 0644 "$PLIST_TMP" "$DAEMON_PATH"

/bin/launchctl bootout "system/$LABEL" 2>/dev/null || true
/bin/launchctl bootstrap system "$DAEMON_PATH"
/bin/launchctl enable "system/$LABEL"
/bin/launchctl kickstart -k "system/$LABEL"

echo 'broker installed; seed the GitHub credential through stdin, then run paperclip doctor'
echo "  sudo '$INSTALL_DIR/focx-credential-broker' store-github-token"
