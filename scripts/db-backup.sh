#!/bin/bash
# ============================================================
# BizBook Pro - Database Backup Script
# ============================================================
# This script creates a timestamped backup of the SQLite database
# before ANY schema migration or code update.
#
# Usage:
#   ./scripts/db-backup.sh          # Create a backup
#   ./scripts/db-backup.sh list     # List all backups
#   ./scripts/db-backup.sh restore  # Restore latest backup
# ============================================================

DB_PATH="db/custom.db"
BACKUP_DIR="db/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/bizbook_backup_${TIMESTAMP}.db"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

case "${1:-backup}" in
  backup)
    if [ ! -f "$DB_PATH" ]; then
      echo "ERROR: Database file not found at $DB_PATH"
      exit 1
    fi

    # Create backup using SQLite's built-in backup command for consistency
    # This ensures the database is not corrupted during backup
    sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'" 2>/dev/null

    # Fallback: if sqlite3 not available, use file copy
    if [ ! -f "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then
      cp "$DB_PATH" "$BACKUP_FILE"
    fi

    # Verify backup
    if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
      BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
      echo "✅ Backup created successfully: $BACKUP_FILE ($BACKUP_SIZE)"

      # Keep only last 20 backups to save disk space
      cd "$BACKUP_DIR"
      ls -t bizbook_backup_*.db 2>/dev/null | tail -n +21 | xargs rm -f 2>/dev/null
    else
      echo "ERROR: Backup failed!"
      exit 1
    fi
    ;;

  list)
    echo "Available backups in $BACKUP_DIR:"
    echo "-----------------------------------"
    ls -lht "${BACKUP_DIR}"/bizbook_backup_*.db 2>/dev/null || echo "No backups found"
    ;;

  restore)
    LATEST=$(ls -t "${BACKUP_DIR}"/bizbook_backup_*.db 2>/dev/null | head -1)
    if [ -z "$LATEST" ]; then
      echo "ERROR: No backups found to restore"
      exit 1
    fi

    # Backup current DB before overwriting
    if [ -f "$DB_PATH" ]; then
      EMERGENCY_BACKUP="${BACKUP_DIR}/emergency_pre_restore_${TIMESTAMP}.db"
      cp "$DB_PATH" "$EMERGENCY_BACKUP"
      echo "Emergency backup of current DB saved: $EMERGENCY_BACKUP"
    fi

    cp "$LATEST" "$DB_PATH"
    echo "✅ Restored database from: $LATEST"
    ;;

  *)
    echo "Usage: $0 [backup|list|restore]"
    exit 1
    ;;
esac
