#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_DB_REL="./data/discord-pulse.db"
DEFAULT_DEPLOY_CMD="git pull --ff-only && npm ci"
KEEP_BACKUPS="${KEEP_BACKUPS:-20}"
BACKUP_BASE_DIR="${BACKUP_BASE_DIR:-$ROOT_DIR/backups/db}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/deploy-safe.sh [--deploy-cmd "..."]
  bash scripts/deploy-safe.sh --restore latest
  bash scripts/deploy-safe.sh --restore <backup_dir>

Environment variables:
  DB_PATH            Override DB path (else read from .env or default ./data/discord-pulse.db)
  DEPLOY_CMD         Deploy command (default: git pull --ff-only && npm ci)
  KEEP_BACKUPS       Number of backups to keep (default: 20)
  BACKUP_BASE_DIR    Backup root directory (default: ./backups/db)

Examples:
  DEPLOY_CMD="git pull --ff-only && npm ci && npm start" bash scripts/deploy-safe.sh
  bash scripts/deploy-safe.sh --restore latest
USAGE
}

read_db_path_from_env_file() {
  local env_file="$ROOT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    echo ""
    return
  fi

  local line
  line="$(grep -E '^DB_PATH=' "$env_file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi

  echo "${line#DB_PATH=}"
}

resolve_db_path() {
  local raw_path="${DB_PATH:-}"
  if [[ -z "$raw_path" ]]; then
    raw_path="$(read_db_path_from_env_file)"
  fi
  if [[ -z "$raw_path" ]]; then
    raw_path="$DEFAULT_DB_REL"
  fi

  if [[ "$raw_path" = /* ]]; then
    echo "$raw_path"
  else
    echo "$ROOT_DIR/$raw_path"
  fi
}

backup_db_files() {
  local db_path="$1"
  local stamp="$2"
  local backup_dir="$BACKUP_BASE_DIR/$stamp"
  mkdir -p "$backup_dir"

  local copied=0
  local file
  for file in "$db_path" "$db_path-wal" "$db_path-shm"; do
    if [[ -f "$file" ]]; then
      cp -p "$file" "$backup_dir/"
      copied=$((copied + 1))
    fi
  done

  cat >"$backup_dir/meta.txt" <<META
created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
root_dir=$ROOT_DIR
db_path=$db_path
copied_files=$copied
META

  echo "$backup_dir"
}

restore_db_files() {
  local db_path="$1"
  local backup_dir="$2"

  if [[ ! -d "$backup_dir" ]]; then
    echo "Backup directory not found: $backup_dir" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$db_path")"

  local name
  for name in "$(basename "$db_path")" "$(basename "$db_path")-wal" "$(basename "$db_path")-shm"; do
    if [[ -f "$backup_dir/$name" ]]; then
      cp -p "$backup_dir/$name" "$(dirname "$db_path")/$name"
    else
      rm -f "$(dirname "$db_path")/$name"
    fi
  done
}

cleanup_old_backups() {
  local keep="$1"
  [[ "$keep" =~ ^[0-9]+$ ]] || return

  local dirs
  dirs="$(find "$BACKUP_BASE_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r || true)"
  if [[ -z "$dirs" ]]; then
    return
  fi

  local idx=0
  while IFS= read -r dir; do
    idx=$((idx + 1))
    if (( idx > keep )); then
      rm -rf "$dir"
    fi
  done <<<"$dirs"
}

restore_mode=""
deploy_cmd="${DEPLOY_CMD:-$DEFAULT_DEPLOY_CMD}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --deploy-cmd)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --deploy-cmd" >&2; exit 1; }
      deploy_cmd="$1"
      ;;
    --restore)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --restore" >&2; exit 1; }
      restore_mode="$1"
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

db_path="$(resolve_db_path)"
mkdir -p "$BACKUP_BASE_DIR"

if [[ -n "$restore_mode" ]]; then
  if [[ "$restore_mode" == "latest" ]]; then
    latest_dir="$(find "$BACKUP_BASE_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1 || true)"
    [[ -n "$latest_dir" ]] || { echo "No backup found in $BACKUP_BASE_DIR" >&2; exit 1; }
    restore_mode="$latest_dir"
  fi

  echo "[deploy-safe] Restoring DB from: $restore_mode"
  restore_db_files "$db_path" "$restore_mode"
  echo "[deploy-safe] Restore completed."
  exit 0
fi

stamp="$(date +"%Y%m%d-%H%M%S")"
backup_dir="$(backup_db_files "$db_path" "$stamp")"

echo "[deploy-safe] Backup created: $backup_dir"
echo "[deploy-safe] Running deploy command: $deploy_cmd"

if ! bash -lc "$deploy_cmd"; then
  echo "[deploy-safe] Deploy command failed. Restoring DB from backup..." >&2
  restore_db_files "$db_path" "$backup_dir"
  echo "[deploy-safe] DB restored from: $backup_dir" >&2
  exit 1
fi

cleanup_old_backups "$KEEP_BACKUPS"
echo "[deploy-safe] Deploy completed successfully. Backup kept at: $backup_dir"
