#!/bin/bash
# Automatry Zero-Touch Device Registration and Provisioning Poller
# This script is designed to run as a system service on a new device.
# It identifies the device, registers with the cloud, and polls for
# provisioning approval.
set -e # Exit immediately if a command exits with a non-zero status.
set -u # Treat unset variables as an error when substituting.

# --- Configuration - IMPORTANT: UPDATE THESE URLS AFTER DEPLOYMENT ---
REGISTER_URL="https://registerdevice-e2ch5jbh6q-ew.a.run.app"
CHECK_STATUS_URL="https://checkdevicestatus-e2ch5jbh6q-ew.a.run.app"
# --- End Configuration ---

# --- State and Log File Paths ---
STATE_DIR="/etc/automatry"
DEVICE_ID_FILE="$STATE_DIR/device.id"
PROVISION_SCRIPT_PATH="/opt/automatry/provision-device.sh"
LOG_FILE="/var/log/automatry-register.log"

# --- Logging Helper ---
# Redirects all output of the script to a log file and to the console.
setup_logging() {
    mkdir -p "$(dirname "$LOG_FILE")"
    touch "$LOG_FILE"
    exec &> >(tee -a "$LOG_FILE")
}

log_action() {
    # The timestamp is now added automatically by `tee` or systemd's journal.
    echo "[REG-SCRIPT] $1"
}

# --- Dependency Installation Helper ---
install_if_missing() {
    local pkg_name=$1
    local install_cmd=$2
    if ! command -v "$pkg_name" &> /dev/null; then
        log_action "Dependency '$pkg_name' not found. Attempting installation..."
        if [ -f /etc/debian_version ]; then
            log_action "Detected Debian-based system (Ubuntu). Using apt."
            sudo apt-get update -y
            sudo apt-get install -y $install_cmd
        else
            log_action "ERROR: Unsupported OS for automatic dependency installation. Please install '$pkg_name' manually."
            exit 1
        fi
        log_action "Dependency '$pkg_name' installed successfully."
    else
        log_action "Dependency '$pkg_name' is already installed."
    fi
}

# --- Main Logic ---
setup_logging
log_action "--- Starting Automatry Device Registration Service ---"

# 1. Install required dependencies
install_if_missing "curl" "curl"
install_if_missing "jq" "jq"
install_if_missing "dmidecode" "dmidecode"

# 2. Get Device Serial Number
log_action "Retrieving System Serial Number..."
SERIAL_NUMBER=$(sudo dmidecode -s system-serial-number | tr -d ' ' | tr -d '\n')
if [ -z "$SERIAL_NUMBER" ]; then
    log_action "ERROR: Could not retrieve a valid serial number from dmidecode. Exiting."
    exit 1
fi
log_action "System Serial Number: $SERIAL_NUMBER"

# 3. Register Device (if it hasn't been registered before)
if [ -f "$DEVICE_ID_FILE" ]; then
    DEVICE_ID=$(cat "$DEVICE_ID_FILE")
    log_action "Device ID already exists: $DEVICE_ID. Skipping registration step."
else
    log_action "Device ID file not found at $DEVICE_ID_FILE. Registering with cloud..."
    
    mkdir -p "$STATE_DIR"

    REGISTRATION_PAYLOAD="{\"serial\": \"$SERIAL_NUMBER\"}"
    
    HTTP_RESPONSE=$(curl --silent --fail --show-error --write-out "HTTPSTATUS:%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$REGISTRATION_PAYLOAD" \
        "$REGISTER_URL")
    
    HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed -e 's/HTTPSTATUS:.*//g')
    HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')

    if [ "$HTTP_STATUS" -ne 200 ] && [ "$HTTP_STATUS" -ne 201 ]; then
        log_action "ERROR: Registration failed with status $HTTP_STATUS. Response: $HTTP_BODY"
        log_action "Will retry after a delay."
        sleep 60
        exit 1
    fi

    DEVICE_ID=$(echo "$HTTP_BODY" | jq -r '.deviceId')
    if [ -z "$DEVICE_ID" ] || [ "$DEVICE_ID" == "null" ]; then
        log_action "ERROR: Registration response did not contain a valid deviceId. Response: $HTTP_BODY"
        exit 1
    fi

    echo "$DEVICE_ID" > "$DEVICE_ID_FILE"
    log_action "Device registered successfully. Firestore Device ID: $DEVICE_ID. Saved to $DEVICE_ID_FILE."
fi

# 4. Poll for Approval Status
log_action "Beginning to poll for provisioning approval for Device ID: $DEVICE_ID"
POLL_INTERVAL=5
MAX_POLL_INTERVAL=300
POLL_COUNT=0
SECONDS_ELAPSED=0

while true; do
    POLL_COUNT=$((POLL_COUNT + 1))
    log_action "Polling attempt #$POLL_COUNT (Interval: ${POLL_INTERVAL}s)..."

    HTTP_RESPONSE=$(curl --silent --fail --show-error --write-out "HTTPSTATUS:%{http_code}" \
        -X GET \
        "$CHECK_STATUS_URL?deviceId=$DEVICE_ID")
    
    HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed -e 's/HTTPSTATUS:.*//g')
    HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')

    if [ "$HTTP_STATUS" -eq 200 ]; then
        STATUS=$(echo "$HTTP_BODY" | jq -r '.status')
        log_action "Received status: '$STATUS'"

        if [ "$STATUS" == "approved" ]; then
            SCRIPT_URL=$(echo "$HTTP_BODY" | jq -r '.scriptUrl')
            if [ -z "$SCRIPT_URL" ] || [ "$SCRIPT_URL" == "null" ]; then
                log_action "ERROR: Status is 'approved' but no scriptUrl was provided. Continuing to poll."
            else
                log_action "APPROVAL GRANTED. Downloading provisioning script from URL."
                
                mkdir -p "$(dirname "$PROVISION_SCRIPT_PATH")"
                curl --fail -L -o "$PROVISION_SCRIPT_PATH" "$SCRIPT_URL"
                
                if [ -s "$PROVISION_SCRIPT_PATH" ]; then
                    log_action "Provisioning script downloaded successfully."
                    chmod +x "$PROVISION_SCRIPT_PATH"
                    log_action "Executing provisioning script in the background..."
                    
                    # Execute the full provisioning script and detach.
                    (sudo "$PROVISION_SCRIPT_PATH") &

                    log_action "--- Provisioning initiated. This registration script has completed its mission. Exiting. ---"
                    exit 0
                else
                    log_action "ERROR: Downloaded provisioning script is empty. Retrying download on next poll."
                    rm -f "$PROVISION_SCRIPT_PATH"
                fi
            fi
        fi
    else
        log_action "WARNING: Polling request failed with HTTP Status $HTTP_STATUS. Will retry."
    fi

    # Exponential Backoff Logic
    SECONDS_ELAPSED=$((SECONDS_ELAPSED + POLL_INTERVAL))
    
    if (( SECONDS_ELAPSED > 2592000 )); then # 30 days
        POLL_INTERVAL=300 # 5 minutes
    elif (( SECONDS_ELAPSED > 604800 )); then # 7 days
        POLL_INTERVAL=60 # 1 minute
    elif (( SECONDS_ELAPSED > 86400 )); then # 1 day
        POLL_INTERVAL=30 # 30 seconds
    elif (( SECONDS_ELAPSED > 3600 )); then # 1 hour
        POLL_INTERVAL=10 # 10 seconds
    fi

    sleep "$POLL_INTERVAL"
done