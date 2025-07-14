#!/bin/bash
#
# Automatry Device Registration and Provisioning Script (v17 - Final Production)
#
# This script is designed to be fully idempotent, zero-touch, and self-healing. It handles:
#  - Dependency checks and installation
#  - Device registration with the cloud
#  - Polling for approval
#  - Atomic download and execution of the final provisioning script
#  - Automatic re-registration if the device is deleted from the cloud portal
#  - Detailed, colored logging to /var/log/automatry-register.log
#
# Usage:
#   sudo ./register-device.sh
#   sudo ./register-device.sh --force-reregister
#

set -euo pipefail

# --- Configuration ---
readonly REGISTER_URL="https://registerdevice-e2ch5jbh6q-ew.a.run.app"
readonly CHECK_STATUS_URL="https://checkdevicestatus-e2ch5jbh6q-ew.a.run.app"
readonly STATE_DIR="/etc/automatry"
readonly DEVICE_ID_FILE="${STATE_DIR}/device.id"
readonly PROVISION_SCRIPT_PATH="/opt/automatry/provision-device.sh"
readonly LOG_FILE="/var/log/automatry-register.log"

# --- Logging (All output redirected to stderr) ---
readonly COLOR_GREEN='\033[0;32m'; readonly COLOR_YELLOW='\033[0;33m'; readonly COLOR_RED='\033[0;31m'; readonly COLOR_NC='\033[0m';
log_info()  { echo -e "${COLOR_GREEN}[INFO]  [$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1${COLOR_NC}" >&2; }
log_warn()  { echo -e "${COLOR_YELLOW}[WARN]  [$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1${COLOR_NC}" >&2; }
log_error() { echo -e "${COLOR_RED}[ERROR] [$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1${COLOR_NC}" >&2; }

# --- CORE HELPER FUNCTIONS ---

cleanup() {
  # This trap function is called on any script exit.
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    log_error "Script exited with error code $exit_code."
  fi
  log_info "Script finished."
}
trap cleanup EXIT INT TERM

setup_logging() {
  # This function should be called after the root check.
  sudo mkdir -p "$(dirname "$LOG_FILE")"; sudo touch "$LOG_FILE"; sudo chown "$(whoami)" "$LOG_FILE" 2>/dev/null || true;
  exec &> >(tee -a "$LOG_FILE")
}

check_sudo() {
  if ! command -v sudo &>/dev/null; then log_error "'sudo' not found. Please install it or run as root."; exit 1; fi
  if [[ $EUID -ne 0 ]]; then log_error "This script must be run with sudo."; exit 1; fi
}

install_if_missing() {
  local -r cmd="$1"; local -r pkg="$2";
  if ! command -v "$cmd" &>/dev/null; then
    log_info "Dependency '$cmd' not found. Installing '$pkg'...";
    sudo apt-get -qq update -y && sudo apt-get -qq install -y "$pkg";
    log_info "Successfully installed '$pkg'."
  else
    log_info "Dependency '$cmd' is already present.";
  fi
}

get_serial_number() {
  local serial; log_info "Retrieving system serial number...";
  serial=$(sudo dmidecode -s system-serial-number 2>/dev/null | tr -d '\r' | tr -cd '[:print:]' | xargs) || serial=""
  if [ -z "$serial" ] || [[ "$serial" == "NotSpecified" ]]; then
    log_warn "dmidecode failed. Trying fallback to DEVICE_SERIAL env var."; serial="${DEVICE_SERIAL:-}";
  fi
  if [ -z "$serial" ]; then log_error "Could not retrieve a valid serial number."; exit 1; fi
  echo "$serial"
}

# --- PROVISIONING WORKFLOW FUNCTIONS ---

register_device() {
  local -r serial_number="$1"; log_info "Attempting to register with serial: $serial_number"
  sudo mkdir -p "$STATE_DIR"
  local response;
  response=$(curl --silent --show-error --fail-with-body -X POST -H "Content-Type: application/json" --data-binary @- "$REGISTER_URL" <<< "$(jq -n --arg serial "$serial_number" '{"serial": $serial}')")
  if [ -z "$response" ]; then log_error "Registration failed: Empty response from server."; return 1; fi
  local device_id; device_id=$(echo "$response" | jq -r '.deviceId')
  if [ -z "$device_id" ] || [ "$device_id" = "null" ]; then
    log_error "Registration failed: Server did not return a valid deviceId. Response: $response"; return 1;
  fi
  echo "$device_id" | sudo tee "$DEVICE_ID_FILE" > /dev/null
  log_info "Device registered successfully. DEVICE_ID=$device_id saved to $DEVICE_ID_FILE"
}

poll_for_approval() {
  local -r device_id="$1"; log_info "Polling for approval for DEVICE_ID=$device_id...";
  local poll_interval=10; local max_poll_duration=$((3*24*3600)); local seconds_elapsed=0; local consecutive_404_errors=0

  while [ "$seconds_elapsed" -lt "$max_poll_duration" ]; do
    log_info "Polling status (interval: ${poll_interval}s)..."
    local http_code; local body;
    body=$(curl --silent --write-out "|%{http_code}" -X POST -H "Content-Type: application/json" --data-binary @- "$CHECK_STATUS_URL" <<< "$(jq -n --arg deviceId "$device_id" '{"deviceId": $deviceId}')")
    http_code="${body##*|}"; body="${body%|*}";
    
    if [[ "$http_code" -eq 404 ]]; then
        consecutive_404_errors=$((consecutive_404_errors + 1))
        log_warn "Status poll failed with HTTP 404. Consecutive 404s: ${consecutive_404_errors}/3."
        if [ "$consecutive_404_errors" -ge 3 ]; then
            log_error "Device ID ${device_id} not found on server. Assuming deleted."
            cleanup_for_reregister; log_warn "Restarting registration process..."; exec sudo "$0" "$@";
        fi
    elif [[ "$http_code" -ne 200 ]]; then
      consecutive_404_errors=0; log_warn "Status poll failed with HTTP status $http_code. Continuing to poll."
    else
      consecutive_404_errors=0
      local state; state=$(echo "$body" | jq -r '.status')
      log_info "Received status from cloud: '$state'"
      if [ "$state" = "approved" ]; then
          local script_url; script_url=$(echo "$body" | jq -r '.scriptUrl')
          if [ -n "$script_url" ] && [ "$script_url" != "null" ]; then
              log_info "Approval granted! Downloading provisioning script..."
              download_and_execute_provision_script "$script_url"
              log_warn "Provisioning script execution failed. Will retry polling in 30s."; sleep 30;
          else
              log_error "Status is 'approved' but server did not provide a scriptUrl. Response: $body"
          fi
      fi
    fi
    seconds_elapsed=$((seconds_elapsed + poll_interval)); sleep "$poll_interval";
  done
  log_error "Polling timed out. Exiting."; exit 1;
}

download_and_execute_provision_script() {
    local url="$1"
    log_info "Downloading and executing provisioning script from $url"
    sudo mkdir -p "$(dirname "$PROVISION_SCRIPT_PATH")"
    
    # Use the robust curl | sudo tee method
    if curl -fsSL "$url" | sudo tee "$PROVISION_SCRIPT_PATH" >/dev/null && \
       sudo chmod +x "$PROVISION_SCRIPT_PATH" && \
       sudo "$PROVISION_SCRIPT_PATH"; then
      log_info "✅ --- Provisioning script executed successfully. Registration complete. ---"
      exit 0
    else
      log_error "Provisioning script failed; cleaning up"
      sudo rm -f "$PROVISION_SCRIPT_PATH"
      return 1
    fi
}

cleanup_for_reregister() {
    log_warn "--- INITIATING FORCE RE-REGISTRATION ---"
    log_info "Cleaning up local state files..."
    sudo rm -f "$DEVICE_ID_FILE" "$PROVISION_SCRIPT_PATH"
    log_info "Cleanup for re-registration complete."
}

# --- SCRIPT ENTRY POINT ---
main() {
  setup_logging
  check_sudo
  
  log_info "--- 🚀 Starting Automatry Device Registration Service (v17) ---"
  
  if [[ "$*" == *--force-reregister* ]]; then
    cleanup_for_reregister
  fi
  
  install_if_missing curl curl
  install_if_missing jq jq
  install_if_missing dmidecode dmidecode

  local device_id=""
  if sudo [ -f "$DEVICE_ID_FILE" ] && sudo [ -s "$DEVICE_ID_FILE" ]; then
    device_id=$(sudo cat "$DEVICE_ID_FILE")
    log_info "Device already registered locally. Using existing DEVICE_ID: $device_id"
  else
    log_info "Device not registered locally. Determining serial number..."
    local serial_number; serial_number=$(get_serial_number)
    log_info "Using device serial: $serial_number"
    
    for i in {1..3}; do
        if register_device "$serial_number"; then
            device_id=$(sudo cat "$DEVICE_ID_FILE")
            break
        fi
        log_warn "Registration attempt $i failed. Retrying in 15 seconds..."; sleep 15;
    done

    if [ -z "${device_id:-}" ]; then
        log_error "FATAL: Could not register device after multiple attempts."; exit 1;
    fi
  fi

  poll_for_approval "$device_id"
}

main "$@"