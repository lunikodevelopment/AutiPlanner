#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Install the AutiPlanner Navet bridge panel into a HACS Navet installation over SSH.

Usage:
  scripts/install-navet-patch.sh --host HOST --port PORT [options]
  scripts/install-navet-patch.sh HOST PORT [options]

Options:
  --host HOST              Home Assistant SSH host or IP address (required)
  --port PORT              SSH port (required)
  --user USER              SSH user (default: root)
  --config-dir PATH        Home Assistant config directory (default: /config)
  --navet-dir PATH         HACS Navet component directory
                           (default: <config-dir>/custom_components/navet)
  --identity-file PATH     SSH private key to use
  --restart-command CMD    Run CMD remotely after installation; opt-in
  --dry-run                Print the local source and remote target without connecting
  -h, --help               Show this help

Examples:
  scripts/install-navet-patch.sh --host 192.168.1.20 --port 22
  scripts/install-navet-patch.sh 192.168.1.20 22 --user root
  scripts/install-navet-patch.sh --host ha.local --port 2222 --user root \
    --identity-file ~/.ssh/id_ed25519 --restart-command 'ha core restart'

The patch keeps Navet's HACS panel intact and registers a separate AutiPlanner
sidebar panel at /autiplanner. It backs up the Navet __init__.py and existing
AutiPlanner web assets outside custom_components before changing anything.
Restarting Home Assistant is disabled unless --restart-command is supplied.
USAGE
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

shell_quote() {
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
navet_dir=''
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
    --navet-dir)
      (($# >= 2)) || die "--navet-dir requires a value"
      navet_dir=$2
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
if [[ -z "$navet_dir" ]]; then
  navet_dir="$config_dir/custom_components/navet"
fi
[[ "$navet_dir" = /* ]] || die '--navet-dir must be an absolute path'

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)
integration_root="$repo_root/integrations/home-assistant"
source_card="$integration_root/www/autiplanner-card.js"
source_icon_font="$integration_root/www/autiplanner-icons.woff2"
source_panel="$integration_root/www/autiplanner-navet-panel.js"

[[ -f "$source_card" ]] || die "Home Assistant card source not found: $source_card"
[[ -f "$source_icon_font" ]] || die "icon font source not found: $source_icon_font"
[[ -f "$source_panel" ]] || die "Navet bridge panel source not found: $source_panel"

if ((dry_run)); then
  printf 'source card: %s\n' "$source_card"
  printf 'source icon font: %s\n' "$source_icon_font"
  printf 'source Navet bridge: %s\n' "$source_panel"
  printf 'Navet target: %s@%s:%s\n' "$user" "$host" "$navet_dir"
  printf 'web target: %s@%s:%s/www\n' "$user" "$host" "$config_dir"
  printf 'sidebar path: /autiplanner\n'
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
quoted_navet_dir=$(shell_quote "$navet_dir")

printf 'Checking SSH access to %s on port %s...\n' "$destination" "$port"
ssh "${ssh_options[@]}" "$destination" 'true'

printf 'Preparing a remote staging directory...\n'
remote_tmp=$(ssh "${ssh_options[@]}" "$destination" "mktemp -d ${quoted_config_dir}/.autiplanner-navet-install.XXXXXX")
remote_tmp=${remote_tmp//$'\r'/}
[[ -n "$remote_tmp" ]] || die 'remote staging directory was not returned'

quoted_remote_tmp=$(shell_quote "$remote_tmp")
printf 'Uploading Navet bridge panel and shared card assets...\n'
tar --exclude='__pycache__' --exclude='*.pyc' -C "$integration_root" -czf - \
  www/autiplanner-card.js www/autiplanner-icons.woff2 www/autiplanner-navet-panel.js | \
  ssh "${ssh_options[@]}" "$destination" "tar -xzf - -C ${quoted_remote_tmp}"

remote_install_script=$(cat <<REMOTE_SCRIPT
set -eu
config_dir=${quoted_config_dir}
navet_dir=${quoted_navet_dir}
staging_dir=${quoted_remote_tmp}
navet_init="\$navet_dir/__init__.py"
navet_manifest="\$navet_dir/manifest.json"
navet_frontend="\$navet_dir/frontend/navet-panel.js"
www_dir="\$config_dir/www"
card_install="\$www_dir/autiplanner-card.js"
font_install="\$www_dir/autiplanner-icons.woff2"
panel_install="\$www_dir/autiplanner-navet-panel.js"
backup_root="\$config_dir/.autiplanner-backups"
backup_dir="\$backup_root/navet-patch-\$(date -u +%Y%m%dT%H%M%SZ)"
init_backup="\$backup_dir/navet-init.py"
card_backup=''
font_backup=''
panel_backup=''
init_patched=0
card_installed=0
font_installed=0
panel_installed=0

rollback() {
  if [ "\$init_patched" = 1 ] && [ -e "\$init_backup" ]; then
    cp "\$init_backup" "\$navet_init"
  fi
  if [ "\$card_installed" = 1 ] && [ -e "\$card_install" ]; then
    rm -f "\$card_install"
  fi
  if [ -n "\$card_backup" ] && [ -e "\$card_backup" ]; then
    mv "\$card_backup" "\$card_install"
  fi
  if [ "\$font_installed" = 1 ] && [ -e "\$font_install" ]; then
    rm -f "\$font_install"
  fi
  if [ -n "\$font_backup" ] && [ -e "\$font_backup" ]; then
    mv "\$font_backup" "\$font_install"
  fi
  if [ "\$panel_installed" = 1 ] && [ -e "\$panel_install" ]; then
    rm -f "\$panel_install"
  fi
  if [ -n "\$panel_backup" ] && [ -e "\$panel_backup" ]; then
    mv "\$panel_backup" "\$panel_install"
  fi
  rm -rf "\$staging_dir"
}
trap rollback EXIT

test -d "\$navet_dir"
test -f "\$navet_manifest"
test -f "\$navet_init"
test -s "\$navet_frontend"
grep -Fq '"domain": "navet"' "\$navet_manifest"

mkdir -p "\$www_dir" "\$backup_dir"
cp "\$navet_init" "\$init_backup"

if ! grep -Fq 'AUTIPLANNER_NAVET_PATCH_BEGIN' "\$navet_init"; then
  patch_tmp="\$(mktemp "\$navet_dir/__init__.py.autiplanner.XXXXXX")"
  sed '/^async def async_setup_entry/,/^async def async_unload_entry/ { /^    return True$/i\\
    # AUTIPLANNER_NAVET_PATCH_BEGIN\\
    await panel_custom.async_register_panel(\\
        hass,\\
        frontend_url_path="autiplanner",\\
        webcomponent_name="autiplanner-navet-panel",\\
        sidebar_title="AutiPlanner",\\
        sidebar_icon="mdi:calendar-check",\\
        module_url="/local/autiplanner-navet-panel.js",\\
        embed_iframe=True,\\
        config={"integration": "navet", "entity": "todo.autiplanner"},\\
    )\\
    # AUTIPLANNER_NAVET_PATCH_END
  }' "\$navet_init" > "\$patch_tmp"
  grep -Fq 'AUTIPLANNER_NAVET_PATCH_BEGIN' "\$patch_tmp"
  grep -Fq 'frontend_url_path="autiplanner"' "\$patch_tmp"
  mv "\$patch_tmp" "\$navet_init"
  init_patched=1
  printf 'patched Navet setup: %s\\n' "\$navet_init"
else
  printf 'Navet setup patch already present: %s\\n' "\$navet_init"
fi

if grep -Fq 'AUTIPLANNER_NAVET_PATCH_BEGIN' "\$navet_init" && ! grep -Fq 'frontend_url_path="autiplanner"' "\$navet_init"; then
  printf 'error: Navet patch marker exists but registration is incomplete\\n' >&2
  exit 1
fi

if grep -Fq 'AUTIPLANNER_NAVET_PATCH_BEGIN' "\$navet_init" && ! grep -Fq 'AUTIPLANNER_NAVET_PATCH_END' "\$navet_init"; then
  printf 'error: Navet patch marker is unterminated\\n' >&2
  exit 1
fi

if ! grep -Fq 'AUTIPLANNER_NAVET_UNLOAD_PATCH_BEGIN' "\$navet_init"; then
  patch_tmp="\$(mktemp "\$navet_dir/__init__.py.autiplanner.XXXXXX")"
  sed '/^    async_remove_panel(hass, PANEL_FRONTEND_PATH/i\\
    # AUTIPLANNER_NAVET_UNLOAD_PATCH_BEGIN\\
    async_remove_panel(hass, "autiplanner", warn_if_unknown=False)\\
    # AUTIPLANNER_NAVET_UNLOAD_PATCH_END' "\$navet_init" > "\$patch_tmp"
  grep -Fq 'AUTIPLANNER_NAVET_UNLOAD_PATCH_BEGIN' "\$patch_tmp"
  grep -Fq 'async_remove_panel(hass, "autiplanner"' "\$patch_tmp"
  mv "\$patch_tmp" "\$navet_init"
  init_patched=1
fi

if grep -Fq 'AUTIPLANNER_NAVET_UNLOAD_PATCH_BEGIN' "\$navet_init" && ! grep -Fq 'AUTIPLANNER_NAVET_UNLOAD_PATCH_END' "\$navet_init"; then
  printf 'error: Navet unload patch marker is unterminated\\n' >&2
  exit 1
fi
if grep -Fq 'AUTIPLANNER_NAVET_UNLOAD_PATCH_BEGIN' "\$navet_init" && ! grep -Fq 'async_remove_panel(hass, "autiplanner"' "\$navet_init"; then
  printf 'error: Navet unload patch marker exists but removal is incomplete\\n' >&2
  exit 1
fi

if [ -e "\$card_install" ]; then
  card_backup="\$backup_dir/autiplanner-card.js"
  cp "\$card_install" "\$card_backup"
fi
if [ -e "\$font_install" ]; then
  font_backup="\$backup_dir/autiplanner-icons.woff2"
  cp "\$font_install" "\$font_backup"
fi
if [ -e "\$panel_install" ]; then
  panel_backup="\$backup_dir/autiplanner-navet-panel.js"
  cp "\$panel_install" "\$panel_backup"
fi
mv "\$staging_dir/www/autiplanner-card.js" "\$card_install"
card_installed=1
test -s "\$card_install"
mv "\$staging_dir/www/autiplanner-icons.woff2" "\$font_install"
font_installed=1
test -s "\$font_install"
mv "\$staging_dir/www/autiplanner-navet-panel.js" "\$panel_install"
panel_installed=1
test -s "\$panel_install"

trap - EXIT
rm -rf "\$staging_dir"
printf 'Navet patch backup: %s\\n' "\$backup_dir"
printf 'installed card: %s\\n' "\$card_install"
printf 'installed icon font: %s\\n' "\$font_install"
printf 'installed bridge panel: %s\\n' "\$panel_install"
printf 'patched Navet: %s\\n' "\$navet_init"
REMOTE_SCRIPT
)

printf 'Patching HACS Navet on the remote host...\n'
ssh "${ssh_options[@]}" "$destination" "$remote_install_script"

if [[ -n "$restart_command" ]]; then
  printf 'Running the requested Home Assistant restart command...\n'
  ssh "${ssh_options[@]}" "$destination" "$restart_command"
else
  printf 'Patch installed. Restart Home Assistant to register the AutiPlanner sidebar panel.\n'
fi
