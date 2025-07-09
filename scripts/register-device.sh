#!/bin/bash
set -euo pipefail

REGISTER_URL="https://registerdevice-e2ch5jbh6q-ew.a.run.app"
CHECK_STATUS_URL="https://checkdevicestatus-e2ch5jbh6q-ew.a.run.app"

STATE_DIR="/etc/automatry"
DEVICE_ID_FILE="$STATE_DIR/device.id"
PROVISION_SCRIPT_PATH="/opt/automatry/provision-device.sh"
LOG_FILE="/var/log/automatry-register.log"

setup_logging() {
  mkdir -p "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE"
  exec &> >(tee -a "$LOG_FILE")
}

log_action() {
  echo "[REG-SCRIPT] $1"
}

install_if_missing() {
  local cmd="$1" pkg="$2"
  if ! command -v "$cmd" &> /dev/null; then
    log_action "Dependency '$cmd' not found. Installing package '$pkg'..."
    if [ -f /etc/debian_version ]; then
      if [ "$pkg" = "sudo" ]; then
        apt-get update
        apt-get install -y sudo
      else
        sudo apt-get update
        sudo apt-get install -y "$pkg"
      fi
      log_action "Installed '$pkg'."
    else
      log_action "ERROR: Unsupported OS. Please install '$pkg' manually."
      exit 1
    fi
  else
    log_action "Dependency '$cmd' already present."
  fi
}

setup_logging
log_action "--- Starting Automatry Device Registration Service ---"

install_if_missing sudo sudo
install_if_missing curl curl
install_if_missing jq jq
install_if_missing dmidecode dmidecode

log_action "Retrieving system serial number via dmidecode..."
SERIAL_NUMBER=""
if command -v dmidecode &> /dev/null; then
  SERIAL_NUMBER=$(sudo dmidecode -s system-serial-number 2>/dev/null | tr -d '[:space:]')
fi

if [ -z "$SERIAL_NUMBER" ] || [[ "$SERIAL_NUMBER" == "NotSpecified" ]]; then
  if [ -n "${DEVICE_SERIAL:-}" ]; then
    log_action "WARNING: dmidecode failed; falling back to DEVICE_SERIAL env var"
    SERIAL_NUMBER="$DEVICE_SERIAL"
  else
    log_action "ERROR: No valid serial number found. Exiting."
    exit 1
  fi
fi
log_action "Using device serial: $SERIAL_NUMBER"

if [ -f "$DEVICE_ID_FILE" ]; then
  DEVICE_ID=$(<"$DEVICE_ID_FILE")
  log_action "Already registered; DEVICE_ID=$DEVICE_ID"
else
  log_action "Registering device with serial $SERIAL_NUMBER..."
  mkdir -p "$STATE_DIR"
  PAYLOAD="{\"serial\":\"$SERIAL_NUMBER\"}"
  HTTP=$(curl --silent --show-error --fail --write-out "HTTPSTATUS:%{http_code}" \
    -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$REGISTER_URL")
  BODY=${HTTP%HTTPSTATUS:*}
  STATUS=${HTTP##*HTTPSTATUS:}

  if [ "$STATUS" -ne 200 ] && [ "$STATUS" -ne 201 ]; then
    log_action "ERROR: Registration failed (HTTP $STATUS). Response: $BODY"
    log_action "Retrying in 60s..."
    sleep 60
    exit 1
  fi

  DEVICE_ID=$(echo "$BODY" | jq -r '.deviceId')
  if [ -z "$DEVICE_ID" ] || [ "$DEVICE_ID" = "null" ]; then
    log_action "ERROR: No deviceId in response. Body: $BODY"
    exit 1
  fi

  echo "$DEVICE_ID" > "$DEVICE_ID_FILE"
  log_action "Registered successfully; DEVICE_ID=$DEVICE_ID saved."
fi

log_action "Polling for provisioning approval (DEVICE_ID=$DEVICE_ID)..."
POLL_INTERVAL=5
SECONDS_ELAPSED=0

while true; do
  log_action "Polling (interval ${POLL_INTERVAL}s)..."
  HTTP=$(curl --silent --show-error --fail --write-out "HTTPSTATUS:%{http_code}" \
    -X GET "$CHECK_STATUS_URL?deviceId=$DEVICE_ID")
  BODY=${HTTP%HTTPSTATUS:*}
  STATUS=${HTTP##*HTTPSTATUS:}

  if [ "$STATUS" -eq 200 ]; then
    STATE=$(echo "$BODY" | jq -r '.status')
    log_action "Status: $STATE"
    if [ "$STATE" = "approved" ]; then
      SCRIPT_URL=$(echo "$BODY" | jq -r '.scriptUrl')
      if [ -n "$SCRIPT_URL" ] && [ "$SCRIPT_URL" != "null" ]; then
        log_action "Approved! Downloading provision script..."
        mkdir -p "$(dirname "$PROVISION_SCRIPT_PATH")"
        curl -L --fail -o "$PROVISION_SCRIPT_PATH" "$SCRIPT_URL"
        if [ -s "$PROVISION_SCRIPT_PATH" ]; then
          log_action "Script downloaded; executing..."
          chmod +x "$PROVISION_SCRIPT_PATH"
          ( sudo "$PROVISION_SCRIPT_PATH" ) &
          log_action "Provisioning started; exiting registration script."
          exit 0
        else
          log_action "ERROR: Downloaded script is empty. Retrying next poll."
          rm -f "$PROVISION_SCRIPT_PATH"
        fi
      else
        log_action "ERROR: approved but no scriptUrl provided."
      fi
    fi
  else
    log_action "Warning: poll HTTP $STATUS. Body: $BODY"
  fi

  SECONDS_ELAPSED=$((SECONDS_ELAPSED + POLL_INTERVAL))
  if (( SECONDS_ELAPSED > 2592000 )); then
    POLL_INTERVAL=300
  elif (( SECONDS_ELAPSED > 604800 )); then
    POLL_INTERVAL=60
  elif (( SECONDS_ELAPSED > 86400 )); then
    POLL_INTERVAL=30
  elif (( SECONDS_ELAPSED > 3600 )); then
    POLL_INTERVAL=10
  fi

  sleep "$POLL_INTERVAL"
done
