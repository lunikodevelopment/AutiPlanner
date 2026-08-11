#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Install the AutiPlanner Home Assistant custom component and Lovelace card over SSH.

Usage:
  scripts/install-home-assistant.sh --host HOST --port PORT [options]
  scripts/install-home-assistant.sh HOST PORT [options]

Options:
  --host HOST              Home Assistant SSH host or IP address (required)
  --port PORT              SSH port (required)
  --user USER              SSH user (default: root)
  --config-dir PATH        Home Assistant config directory (default: /config)
  --identity-file PATH     SSH private key to use
  --restart-command CMD    Run CMD remotely after installation; opt-in
  --dry-run                Print the local source and remote target without connecting
  -h, --help               Show this help

Examples:
  scripts/install-home-assistant.sh --host 192.168.1.20 --port 22
  scripts/install-home-assistant.sh 192.168.1.20 22 --user root
  scripts/install-home-assistant.sh --host ha.local --port 2222 --user root \
    --identity-file ~/.ssh/id_ed25519 --config-dir /config
  scripts/install-home-assistant.sh --host ha.local --port 22 \
    --restart-command 'ha core restart'

The script does not delete an existing component or card. It moves each to a
timestamped backup before installing the new copy. Restarting Home Assistant is
disabled unless --restart-command is explicitly supplied.
USAGE
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

shell_quote() {
  # POSIX shell quoting for arguments embedded in an SSH command string.
  local value=${1-}
  value=${value//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

host=''
port=''
user='root'
config_dir='/config'
identity_file=''
restart_command=''
dry_run=0

if (($# >= 2)) && [[ "$1" != -* ]] && [[ "$2" != -* ]]; then
  host=$1
  port=$2
  shift 2
fi

while (($# > 0)); do
  case "$1" in
    --host)
      (($# >= 2)) || die "--host requires a value"
      host=$2
      shift 2
      ;;
    --port)
      (($# >= 2)) || die "--port requires a value"
      port=$2
      shift 2
      ;;
    --user)
      (($# >= 2)) || die "--user requires a value"
      user=$2
      shift 2
      ;;
    --config-dir)
      (($# >= 2)) || die "--config-dir requires a value"
      config_dir=$2
      shift 2
      ;;
    --identity-file)
      (($# >= 2)) || die "--identity-file requires a value"
      identity_file=$2
      shift 2
      ;;
    --restart-command)
      (($# >= 2)) || die "--restart-command requires a value"
      restart_command=$2
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$host" ]] || die '--host is required'
[[ -n "$port" ]] || die '--port is required'
[[ "$port" =~ ^[0-9]+$ ]] && ((port >= 1 && port <= 65535)) || die "invalid SSH port: $port"
[[ -n "$user" ]] || die '--user must not be empty'
[[ "$config_dir" = /* ]] || die '--config-dir must be an absolute path'

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)
source_root="$repo_root/integrations/home-assistant/custom_components"
source_component="$source_root/autiplanner"
integration_root="$repo_root/integrations/home-assistant"
source_card="$integration_root/www/autiplanner-card.js"

[[ -d "$source_component" ]] || die "custom component source not found: $source_component"
[[ -f "$source_component/manifest.json" ]] || die "manifest.json not found in $source_component"
[[ -f "$source_card" ]] || die "Home Assistant card source not found: $source_card"

if ((dry_run)); then
  printf 'source: %s\n' "$source_component"
  printf 'destination: %s@%s:%s/custom_components/autiplanner\n' "$user" "$host" "$config_dir"
  printf 'card destination: %s@%s:%s/www/autiplanner-card.js\n' "$user" "$host" "$config_dir"
  printf 'ssh port: %s\n' "$port"
  if [[ -n "$identity_file" ]]; then
    printf 'identity file: %s\n' "$identity_file"
  fi
  if [[ -n "$restart_command" ]]; then
    printf 'restart command: %s\n' "$restart_command"
  else
    printf 'restart: disabled (use --restart-command to opt in)\n'
  fi
  exit 0
fi

require_command ssh
require_command tar

if [[ -n "$identity_file" ]]; then
  [[ -f "$identity_file" ]] || die "SSH identity file not found: $identity_file"
fi

ssh_options=(-o ConnectTimeout=15 -p "$port")
if [[ -n "$identity_file" ]]; then
  ssh_options+=(-i "$identity_file")
fi
destination="$user@$host"
quoted_config_dir=$(shell_quote "$config_dir")

printf 'Checking SSH access to %s on port %s...\n' "$destination" "$port"
ssh "${ssh_options[@]}" "$destination" 'true'

printf 'Preparing a remote staging directory...\n'
remote_tmp=$(ssh "${ssh_options[@]}" "$destination" "mktemp -d ${quoted_config_dir}/.autiplanner-install.XXXXXX")
remote_tmp=${remote_tmp//$'\r'/}
[[ -n "$remote_tmp" ]] || die 'remote staging directory was not returned'

quoted_remote_tmp=$(shell_quote "$remote_tmp")
printf 'Uploading custom component and Lovelace card...\n'
tar --exclude='__pycache__' --exclude='*.pyc' -C "$integration_root" -czf - custom_components/autiplanner www/autiplanner-card.js | \
  ssh "${ssh_options[@]}" "$destination" "tar -xzf - -C ${quoted_remote_tmp}"

remote_install_script=$(cat <<REMOTE_SCRIPT
set -eu
config_dir=${quoted_config_dir}
staging_dir=${quoted_remote_tmp}
install_dir="\$config_dir/custom_components/autiplanner"
card_dir="\$config_dir/www"
card_install="\$card_dir/autiplanner-card.js"
backup_dir=''
card_backup=''
component_installed=0
card_installed=0

rollback() {
  if [ "\$component_installed" = 1 ] && [ -e "\$install_dir" ]; then
    rm -rf "\$install_dir"
  fi
  if [ -n "\$backup_dir" ] && [ ! -e "\$install_dir" ] && [ -e "\$backup_dir" ]; then
    mv "\$backup_dir" "\$install_dir"
  fi
  if [ "\$card_installed" = 1 ] && [ -e "\$card_install" ]; then
    rm -f "\$card_install"
  fi
  if [ -n "\$card_backup" ] && [ ! -e "\$card_install" ] && [ -e "\$card_backup" ]; then
    mv "\$card_backup" "\$card_install"
  fi
  rm -rf "\$staging_dir"
}
trap rollback EXIT

mkdir -p "\$config_dir/custom_components"
if [ -e "\$install_dir" ]; then
  backup_dir="\$install_dir.backup.\$(date -u +%Y%m%dT%H%M%SZ)"
  mv "\$install_dir" "\$backup_dir"
  printf 'backup: %s\\n' "\$backup_dir"
fi
mv "\$staging_dir/custom_components/autiplanner" "\$install_dir"
component_installed=1
test -f "\$install_dir/manifest.json"
test -f "\$install_dir/config_flow.py"
grep -Fq 'class AutiPlannerConfigFlow' "\$install_dir/config_flow.py"
if grep -R -n -F -e 'custom_components.autiplanner.backup' -e 'from .backup' "\$install_dir"; then
  printf 'error: installed component still references missing autiplanner.backup\n' >&2
  exit 1
fi
printf 'installed manifest: '
grep -m1 '"version"' "\$install_dir/manifest.json"
mkdir -p "\$card_dir"
if [ -e "\$card_install" ]; then
  card_backup="\$card_install.backup.\$(date -u +%Y%m%dT%H%M%SZ)"
  mv "\$card_install" "\$card_backup"
  printf 'card backup: %s\\n' "\$card_backup"
fi
mv "\$staging_dir/www/autiplanner-card.js" "\$card_install"
card_installed=1
test -s "\$card_install"
trap - EXIT
rm -rf "\$staging_dir"
printf 'installed: %s\\n' "\$install_dir"
printf 'installed card: %s\\n' "\$card_install"
REMOTE_SCRIPT
)

printf 'Installing component on the remote host...\n'
ssh "${ssh_options[@]}" "$destination" "$remote_install_script"

if [[ -n "$restart_command" ]]; then
  printf 'Running the requested Home Assistant restart command...\n'
  ssh "${ssh_options[@]}" "$destination" "$restart_command"
else
  printf 'Installation complete. Restart Home Assistant to load the updated component.\n'
fi
