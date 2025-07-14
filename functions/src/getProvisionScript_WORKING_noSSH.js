/* eslint-disable no-useless-escape */
// functions/src/getProvisionScript.js
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const fetch = require("node-fetch");
const { db } = require("../firebaseClient");
const { FieldValue } = require("firebase-admin/firestore");

// Using the centralized config module is the cleanest approach.
const { config, definedSecrets } = require("./config");

async function generateTailscaleKey(serial, apiKey) {
  const functionName = "generateTailscaleKey";
  if (!apiKey) {
    throw new Error("Configuration Error: Tailscale API key is missing.");
  }
  const url = `https://api.tailscale.com/api/v2/tailnet/${config.tailnet}/keys`;
  const safeSerial = (serial || "").replace(/[^a-zA-Z0-9 _-]/g, "");
  const description = `Provision key ${safeSerial}`;
  const body = {
    capabilities: {
      devices: {
        create: {
          reusable: false,
          ephemeral: false,
          preauthorized: true,
          tags: [config.tailscaleTag],
        },
      },
    },
    expirySeconds: config.tailscaleKeyExpirySeconds,
    description: description,
  };
  logger.info({
    message: "Generating Tailscale Auth Key",
    functionName,
    tailnet: config.tailnet,
    serial,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Tailscale API error (${response.status}): ${responseText}`
    );
  }
  const data = JSON.parse(responseText);
  if (!data.key || !data.key.startsWith("tskey-auth-")) {
    throw new Error("Tailscale API did not return a valid auth key.");
  }
  logger.info({
    message: "Tailscale Auth Key generated successfully.",
    functionName,
    keyId: data.id,
  });
  return data.key;
}

function generateScript(params) {
  const {
    deviceId,
    serial,
    apartment,
    apartmentId,
    project,
    tailscaleAuthKey,
    containerName,
    dockerPullerKeyJson,
    registryHost,
    deviceUpdateTokenValue,
  } = params;

  // This script is designed to be idempotent and robust.
  return `#!/bin/bash
# Auto-generated provisioning script for device: ${serial}
# Generated at: ${new Date().toISOString()}
set -euo pipefail

# --- Configuration ---
LOG_PREFIX="[PROV-SCRIPT] [$(date -u +'%Y-%m-%dT%H:%M:%SZ')]"
UPDATE_STATUS_URL="${config.updateStatusUrl}"
DEVICE_UPDATE_TOKEN="${deviceUpdateTokenValue}"

CONFIG_DIR="/etc/automatry"
ENV_FILE="\${CONFIG_DIR}/device.env"
HOST_CREDENTIAL_PATH="\${CONFIG_DIR}/docker-puller-key.json"
HOST_LOGS_PATH="/var/log/automatry/container_logs"
HOST_DATA_PATH="\${CONFIG_DIR}/data"
CONTAINER_NAME="${containerName}"

# --- Helper Functions ---
log_action() {
    echo "\${LOG_PREFIX} \$1"
}

report_status() {
    local status_message="\$1"
    local device_id; device_id=\$(grep -E '^DEVICE_ID=' "\${ENV_FILE}" 2>/dev/null | cut -d '=' -f2) || device_id="${deviceId}"
    
    if [ -z "\${device_id}" ]; then
        log_action "WARNING: Cannot report status '\${status_message}' because DEVICE_ID is not set."
        return
    fi

    local payload; payload=$(printf '{"deviceId": "%s", "provisioningStatus": "%s"}' "\${device_id}" "\${status_message}")
    
    log_action "Reporting status to cloud: \${status_message}"
    curl --fail-with-body -sS -X POST \\
      -H "Content-Type: application/json" \\
      -H "Authorization: Bearer \${DEVICE_UPDATE_TOKEN}" \\
      -d "\${payload}" \\
      "\${UPDATE_STATUS_URL}" || log_action "WARNING: Failed to report status '\${status_message}' to the cloud."
}

install_tailscale() {
    log_action "Checking for Tailscale..."
    if command -v tailscale &> /dev/null; then
        log_action "Tailscale is already installed."
        return 0
    fi

    report_status "installing_tailscale"
    log_action "Installing Tailscale..."
    
    # Add Tailscale's package signing key and repository
    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list

    log_action "Updating package lists after adding Tailscale repository..."
    sudo apt-get update -y

    log_action "Installing tailscale package..."
    sudo apt-get install -y tailscale

    if ! command -v tailscale &> /dev/null; then
        log_action "ERROR: Tailscale installation failed."
        report_status "tailscale_install_failed"
        exit 1
    fi
    log_action "Tailscale installed successfully."
}

install_nomachine() {
    log_action "Checking for NoMachine..."
    if [ -d "/usr/NX" ]; then
        log_action "NoMachine appears to be already installed."
        return 0
    fi

    report_status "installing_nomachine"
    log_action "Installing NoMachine..."
    
    local NOMACHINE_URL="https://download.nomachine.com/download/9.0/Linux/nomachine_9.0.188_11_amd64.deb"
    local NOMACHINE_DEB="/tmp/nomachine_amd64.deb"

    log_action "Downloading NoMachine from \${NOMACHINE_URL}..."
    curl -fL -o "\${NOMACHINE_DEB}" "\${NOMACHINE_URL}"

    log_action "Installing NoMachine package..."
    sudo dpkg -i "\${NOMACHINE_DEB}"

    log_action "Fixing any missing dependencies for NoMachine..."
    sudo apt-get install -f -y

    log_action "Cleaning up NoMachine installer file..."
    rm -f "\${NOMACHINE_DEB}"

    if ! [ -d "/usr/NX" ]; then
        log_action "ERROR: NoMachine installation failed."
        report_status "nomachine_install_failed"
        exit 1
    fi
    log_action "NoMachine installed successfully."
}

# --- Main Execution ---
log_action "--- 🚀 Starting Full Provisioning Process for ${serial} ---"

log_action "Creating required directories..."
sudo mkdir -p "\${CONFIG_DIR}" "\${HOST_LOGS_PATH}" "\${HOST_DATA_PATH}"

log_action "Creating environment file at \${ENV_FILE}..."
cat << EOF | sudo tee "\${ENV_FILE}" > /dev/null
# Auto-generated by provisioning script
DEVICE_ID=${deviceId}
APARTMENT=${apartment}
APARTMENT_ID=${apartmentId}
PROJECT=${project}
WS_SERVER_URL=ws://localhost:3000/ws
LOG_BUCKET_NAME=${config.logBucketName}
DEVICE_UPDATE_TOKEN=${deviceUpdateTokenValue}
GOOGLE_APPLICATION_CREDENTIALS=/app/credentials.json
LOG_BASE_DIR=/app/logs
EOF

report_status "installing_dependencies"
install_tailscale
install_nomachine

if ! command -v docker &> /dev/null; then
    log_action "Docker not found. Installing docker.io..."
    sudo apt-get update -y && sudo apt-get install -y docker.io
else
    log_action "Docker is already installed."
fi

report_status "configuring_tailscale"
log_action "Enabling and starting tailscaled service..."
sudo systemctl enable --now tailscaled

log_action "Connecting to tailnet as '${serial}'..."
sudo tailscale up --authkey="${tailscaleAuthKey}" --hostname="${serial}" --accept-routes

report_status "authenticating_docker"
log_action "Creating persistent Docker pull credentials at \${HOST_CREDENTIAL_PATH}..."
echo '${dockerPullerKeyJson}' | sudo tee "\${HOST_CREDENTIAL_PATH}" >/dev/null
sudo chmod 600 "\${HOST_CREDENTIAL_PATH}"

log_action "Authenticating Docker with Google Artifact Registry at https://${registryHost}..."
cat "\${HOST_CREDENTIAL_PATH}" | sudo docker login -u _json_key --password-stdin https://${registryHost}
log_action "Docker authentication complete."

report_status "deploying_application_container"
log_action "Pulling required Docker image: ${config.deviceDockerImage}"
sudo docker pull "${config.deviceDockerImage}"

log_action "Ensuring no old container named '\${CONTAINER_NAME}' exists..."
if sudo docker ps -a --format '{{.Names}}' | grep -Eq "^\\s*\${CONTAINER_NAME}\\s*$"; then
    log_action "Stopping and removing existing container: \${CONTAINER_NAME}"
    sudo docker stop "\${CONTAINER_NAME}" >/dev/null 2>&1 || true
    sudo docker rm "\${CONTAINER_NAME}" >/dev/null 2>&1 || true
fi

log_action "Starting new application container: \${CONTAINER_NAME}"
sudo docker run -d \\
    --name "\${CONTAINER_NAME}" \\
    --restart=always \\
    --network=host \\
    --env-file "\${ENV_FILE}" \\
    -v "\${HOST_CREDENTIAL_PATH}:/app/credentials.json:ro" \\
    -v "\${HOST_DATA_PATH}:/app/data" \\
    -v "\${HOST_LOGS_PATH}:/app/logs" \\
    "${config.deviceDockerImage}"

sleep 5
if ! sudo docker ps --format '{{.Names}}' | grep -Eq "^\\s*\${CONTAINER_NAME}\\s*$"; then
    log_action "ERROR: Container \${CONTAINER_NAME} failed to start."
    report_status "container_start_failed"
    exit 1
fi

report_status "provisioning_complete"
log_action "--- ✅ Provisioning script execution completed successfully. ---"
exit 0
`;
}

exports.getProvisionScript = onRequest(
  {
    region: "europe-west1",
    secrets: definedSecrets,
  },
  async (req, res) => {
    const functionName = "getProvisionScript";
    logger.info({
      message: "Function execution started.",
      functionName,
      ip: req.ip,
    });

    try {
      const secrets = config.getSecrets();
      config.validate(secrets);

      if (req.method !== "GET") {
        logger.warn({ message: "Method Not Allowed.", functionName, method: req.method });
        return res.status(405).send("Method Not Allowed");
      }

      const deviceHash = req.query.device_hash;
      if (!deviceHash || !/^[a-f0-9]{64}$/i.test(deviceHash)) {
        logger.error({ message: "Bad Request: Invalid 'device_hash' format.", functionName, query: req.query });
        return res
          .status(400)
          .send("Bad Request: Invalid 'device_hash' format.");
      }

      const devicesRef = db.collection("devices");
      const snapshot = await devicesRef
        .where("hash", "==", deviceHash)
        .limit(1)
        .get();

      if (snapshot.empty) {
        logger.warn({ message: "Unauthorized device: Hash not found.", functionName, deviceHash });
        return res.status(403).send("Unauthorized device: Hash not found.");
      }

      const doc = snapshot.docs[0];
      const deviceData = doc.data();
      if (deviceData.approvedForProvisioning !== true) {
        logger.warn({ message: "Provisioning not approved for device.", functionName, deviceId: doc.id });
        await doc.ref.update({
          provisioningStatus: "approval_pending_request_received",
        });
        return res
          .status(403)
          .send("Unauthorized: Device provisioning has not been approved.");
      }

      const tailscaleAuthKey = await generateTailscaleKey(
        deviceData.serial,
        secrets.tailscaleApiKey
      );

      const updatePayload = {
        provisioningStatus: "generating_script",
        lastProvisionRequest: FieldValue.serverTimestamp(),
      };
      if (req.ip) {
        updatePayload.lastProvisionIP = req.ip;
      }
      await doc.ref.update(updatePayload);

      // --- FIX: Correctly parse the registry host from the full image name ---
      const registryHost = config.deviceDockerImage.split('/')[0];
      if (!registryHost.includes('docker.pkg.dev')) {
          const errorMessage = `Invalid DEVICE_DOCKER_IMAGE format: ${config.deviceDockerImage}. Expected a docker.pkg.dev host.`;
          logger.error({ message: errorMessage, functionName, deviceId: doc.id });
          throw new Error(errorMessage);
      }

      const script = generateScript({
        deviceId: doc.id,
        serial: deviceData.serial,
        apartment: deviceData.identity?.APARTMENT,
        apartmentId: deviceData.identity?.APARTMENT_ID,
        project: deviceData.identity?.PROJECT,
        tailscaleAuthKey,
        containerName: "bacnet-reader-service",
        dockerPullerKeyJson: secrets.dockerPullerKey,
        registryHost, // Pass the correct host to the script generator
        deviceUpdateTokenValue: secrets.deviceUpdateToken,
      });

      logger.info({
        message: "Provisioning script generated successfully.",
        functionName,
        deviceId: doc.id,
      });
      res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="provision-${deviceData.serial}.sh"`
      );
      return res.status(200).send(script);
    } catch (error) {
      logger.error({
        message: "Fatal error during script generation.",
        functionName,
        error: error.message,
        stack: error.stack,
      });
      return res.status(500).send(`Internal Server Error: ${error.message}`);
    }
  }
);