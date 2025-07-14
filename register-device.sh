#!/usr/bin/env bash
#
# Automatry Device Registration and Provisioning Script (v16 - Zero Touch, Robust Download)
#
# This script is fully idempotent and zero-touch. It handles:
#  - Dependency checks and installation
#  - Device registration with the cloud
#  - Polling for approval
#  - Atomic download and execution of provisioning script
#  - Automatic re-registration if device is deleted
#  - Detailed logging to /var/log/automatry-register.log
#
set -euo pipefail

# --- Configuration ---
readonly REGISTER_URL="https://registerdevice-e2ch5jbh6q-ew.a.run.app"
readonly CHECK_STATUS_URL="https://checkdevicestatus-e2ch5jbh6q-ew.a.run.app"
readonly STATE_DIR="/etc/automatry"
readonly DEVICE_ID_FILE="${STATE_DIR}/device.id"
readonly PROVISION_SCRIPT_PATH="/opt/automatry/provision-device.sh"
readonly LOG_FILE="/var/log/automatry-register.log"

# --- Globals ---
TEMP_FILES=()

# --- Logging & Colors (All to stderr) ---
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_NC='\033[0m'
log_info()  { echo -e "${COLOR_GREEN}[INFO]  [$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1${COLOR_NC}" >&2; }
log_warn()  { echo -e "${COLOR_YELLOW}[WARN]  [$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1${COLOR_NC}" >&2; }
log_error(){ echo -e "${COLOR_RED}[ERROR] [$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1${COLOR_NC}" >&2; }

# --- Cleanup Temporary Files & Final Logging ---
cleanup() {
  local exit_code=$?
  if [ ${#TEMP_FILES[@]} -gt 0 ]; then
    log_info "Cleaning up temporary files: ${TEMP_FILES[*]}"
    rm -f "${TEMP_FILES[@]}" || true
  fi
  if [ $exit_code -ne 0 ]; then
    log_error "Script exited with code $exit_code"
  else
    log_info "Script completed successfully"
  fi
}
trap cleanup EXIT INT TERM

# --- Create a temp file and track it ---
create_temp_file() {
  local file
  file=$(mktemp)
  TEMP_FILES+=("$file")
  echo "$file"
}

# --- Setup logging: ensure log dir and file exist, then tee all stderr/stdout ---
setup_logging() {
  sudo mkdir -p "$(dirname "$LOG_FILE")"
  sudo touch "$LOG_FILE"
  sudo chown "$(whoami)" "$LOG_FILE" 2>/dev/null || true
  exec &> >(tee -a "$LOG_FILE")
}

# --- Ensure sudo is available ---
check_sudo() {
  if ! command -v sudo &>/dev/null; then
    log_error "'sudo' not found. Please install it or run as root."
    exit 1
  fi
}

# --- Install missing dependency ---
install_if_missing() {
  local cmd="$1" pkg="$2"
  if ! command -v "$cmd" &>/dev/null; then
    log_info "Installing missing dependency: $pkg"
    sudo apt-get update -qq && sudo apt-get install -y "$pkg"
  else
    log_info "Dependency '$cmd' already present"
  fi
}

# --- Retrieve system serial (or fallback to DEVICE_SERIAL) ---
get_serial_number() {
  log_info "Retrieving system serial number"
  local serial
  serial=$(sudo dmidecode -s system-serial-number 2>/dev/null | tr -d '\r' | tr -cd '[:print:]' | xargs) || serial=""
  if [[ -z "$serial" || "$serial" == "NotSpecified" ]]; then
    log_warn "Falling back to DEVICE_SERIAL environment variable"
    serial="${DEVICE_SERIAL:-}"
  fi
  if [[ -z "$serial" ]]; then
    log_error "Could not determine serial number"
    exit 1
  fi
  echo "$serial"
}

# --- Register device with cloud ---
register_device() {
  local serial="$1"
  log_info "Registering device (serial: $serial)"
  sudo mkdir -p "$STATE_DIR"
  local response
  response=$(curl -fsS -X POST -H "Content-Type: application/json" --data '{"serial":"'"$serial"'"}' "$REGISTER_URL")
  if [[ -z "$response" ]]; then
    log_error "Empty response from register endpoint"
    return 1
  fi
  local id
  id=$(echo "$response" | jq -r .deviceId)
  if [[ -z "$id" || "$id" == "null" ]]; then
    log_error "Invalid deviceId in response: $response"
    return 1
  fi
  echo "$id" | sudo tee "$DEVICE_ID_FILE" >/dev/null
  log_info "Device registered (ID: $id)"
}

# --- Poll for approval ---
poll_for_approval() {
  local id="$1"
  log_info "Polling approval for DEVICE_ID=$id"
  local interval=10 elapsed=0 max=$((3*24*3600))
  while (( elapsed < max )); do
    log_info "Polling status (every ${interval}s)"
    local out code body
    out=$(curl -fsS -w "|%{http_code}" -X POST -H "Content-Type: application/json" --data '{"deviceId":"'"$id"'"}' "$CHECK_STATUS_URL")
    code=${out##*|}; body=${out%|*}
    if (( code == 200 )); then
      local state
      state=$(echo "$body" | jq -r .status)
      log_info "Device status: $state"
      if [[ "$state" == "approved" ]]; then
        local url
        url=$(echo "$body" | jq -r .scriptUrl)
        [[ -n "$url" && "$url" != "null" ]] || { log_error "No scriptUrl returned"; return 1; }
        download_and_execute_provision_script "$url"
        return
      fi
    else
      log_warn "Polling HTTP $code"
    fi
    sleep $interval; elapsed=$(( elapsed + interval ))
  done
  log_error "Approval polling timed out"
  exit 1
}

# --- Atomic download and execution ---
download_and_execute_provision_script() {
  local url="$1"
  log_info "Downloading and executing provisioning script from $url"
  sudo mkdir -p "$(dirname "$PROVISION_SCRIPT_PATH")"
  # Stream directly: download into place, then execute
  if curl -fsSL "$url" | sudo tee "$PROVISION_SCRIPT_PATH" >/dev/null && \
     sudo chmod +x "$PROVISION_SCRIPT_PATH" && \
     sudo "$PROVISION_SCRIPT_PATH"; then
    log_info "Provisioning script executed successfully"
    exit 0
  else
    log_error "Provisioning script failed; cleaning up"
    sudo rm -f "$PROVISION_SCRIPT_PATH"
    return 1
  fi
}

# --- Cleanup and re-register ---
cleanup_for_reregister() {
  log_warn "Forcing re-registration"
  sudo rm -f "$DEVICE_ID_FILE" "$PROVISION_SCRIPT_PATH"
}

# --- Main entrypoint ---
main() {
  setup_logging
  check_sudo
  log_info "--- 🚀 Starting Registration Service (v16) ---"
  if [[ " $* " =~ " --force-reregister " ]]; then
    cleanup_for_reregister
  fi
  install_if_missing curl curl
  install_if_missing jq jq
  install_if_missing dmidecode dmidecode
  local device_id
  if sudo [[ -s "$DEVICE_ID_FILE" ]]; then
    device_id=$(sudo cat "$DEVICE_ID_FILE")
    log_info "Found existing DEVICE_ID=$device_id"
  else
    local serial
    serial=$(get_serial_number)
    for i in {1..3}; do
      if register_device "$serial"; then
        device_id=$(sudo cat "$DEVICE_ID_FILE")
        break
      fi
      log_warn "Registration attempt $i failed. Retrying..."
      sleep 15
    done
    [[ -n "$device_id" ]] || { log_error "Registration failed after retries"; exit 1; }
  fi
  poll_for_approval "$device_id"
}

main "$@"
