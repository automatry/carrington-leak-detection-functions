// functions/src/getProvisionScript.js
const functions = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const fetch = require("node-fetch");
const crypto = require("crypto");
const { admin, db } = require("../firebaseClient");
const { FieldValue } = require("firebase-admin/firestore");

// --- Configuration ---
// Read secrets and environment variables once.
const TAILSCALE_API_KEY = process.env.TAILSCALE_API_KEY;
const DEVICE_UPDATE_TOKEN = process.env.DEVICE_UPDATE_TOKEN;
const TAILNET = process.env.TAILSCALE_TAILNET || "missing-tailnet.ts.net";
const TAILSCALE_TAG = process.env.TAILSCALE_PROVISION_TAG || "tag:provisioned";
const DEVICE_DOCKER_IMAGE = process.env.DEVICE_DOCKER_IMAGE;
const UPDATE_STATUS_URL = process.env.DEVICE_STATUS_UPDATE_URL;
const WS_SERVER_URL = process.env.WS_SERVER_URL;
const LOG_BUCKET_NAME = process.env.LOG_BUCKET_NAME;

const FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
const TAILSCALE_KEY_EXPIRY_SECONDS = 600;

/**
 * Generates a one-time use Tailscale authentication key.
 * @param {string} serial The device serial number, used for logging.
 * @returns {Promise<string>} The Tailscale auth key.
 */
async function generateTailscaleKey(serial) {
  const functionName = "generateTailscaleKey";
  if (!TAILSCALE_API_KEY) {
    logger.error({
      message: "Tailscale API key (TAILSCALE_API_KEY) is not configured.",
      functionName,
    });
    throw new Error("Configuration Error: Tailscale API key missing.");
  }
  if (!TAILNET || TAILNET.includes("missing-tailnet")) {
    logger.error({
      message: "Tailscale Tailnet (TAILSCALE_TAILNET) is not configured.",
      functionName,
    });
    throw new Error("Configuration Error: Tailscale Tailnet missing.");
  }

  const url = `https://api.tailscale.com/api/v2/tailnet/${TAILNET}/keys`;
  const body = {
    capabilities: {
      devices: {
        create: {
          reusable: false,
          ephemeral: false,
          preauthorized: true,
          tags: [TAILSCALE_TAG],
        },
      },
    },
    expirySeconds: TAILSCALE_KEY_EXPIRY_SECONDS,
    description: `Provisioning key for device S/N: ${serial}`,
  };

  logger.info({
    message: "Generating Tailscale Auth Key",
    functionName,
    tailnet: TAILNET,
    serial,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TAILSCALE_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    if (!response.ok) {
      logger.error({
        message: "Tailscale API error",
        functionName,
        serial,
        status: response.status,
        errorBody: responseText,
      });
      throw new Error(
        `Tailscale API error (${response.status}): ${responseText}`
      );
    }

    const data = JSON.parse(responseText);
    if (!data.key || !data.key.startsWith("tskey-auth-")) {
      logger.error({
        message: "Tailscale API response missing valid key.",
        functionName,
        serial,
        responseData: data,
      });
      throw new Error("Tailscale API did not return a valid auth key.");
    }

    logger.info({
      message: "Tailscale Auth Key generated successfully.",
      functionName,
      serial,
      keyId: data.id,
    });
    return data.key;
  } catch (error) {
    logger.error({
      message: "Failed to generate Tailscale auth key.",
      functionName,
      serial,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Generates the main provisioning script for the device.
 * @param {object} params Parameters for script generation.
 * @returns {string} The generated shell script.
 */
function generateScript(params) {
  const {
    deviceId,
    serial,
    apartment,
    apartmentId,
    project,
    tailscaleAuthKey,
    containerName,
  } = params;

  const scriptLines = [
    "#!/bin/bash",
    "# Auto-generated provisioning script",
    "set -euo pipefail",
    "",
    "## --- Logging and Helper Functions ---",
    "log_action() { echo \"[PROV-SCRIPT] [$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1\"; }",
    "",
    "report_status() {",
    '    local status_message="$1"',
    "    local payload",
    '    payload=$(printf \'{"deviceId": "%s", "provisioningStatus": "%s"}\' "${DEVICE_ID}" "$status_message")',
    '    log_action "Reporting status to cloud: ${status_message}"',
    '    curl --fail-with-body -sS -X POST -H "Content-Type: application/json" -H "Authorization: Bearer ${DEVICE_UPDATE_TOKEN}" -d "${payload}" "${UPDATE_STATUS_URL}" || log_action "WARNING: Failed to report status \'${status_message}\' to the cloud."',
    "}",
    "",
    "install_if_missing() {",
    '    local cmd_to_check="$1" pkg_to_install="$2"',
    '    if ! command -v "${cmd_to_check}" &> /dev/null; then',
    "        log_action \"Dependency '${cmd_to_check}' not found. Installing package '${pkg_to_install}'...\"",
    '        sudo apt-get update -y && sudo apt-get install -y "${pkg_to_install}"',
    "    else",
    "        log_action \"Dependency '${cmd_to_check}' already present.\"",
    "    fi",
    "}",
    "",
    "## --- Main Execution ---",
    'log_action "--- 🚀 Starting Full Provisioning Process ---"',
    "",
    "## --- Exporting Configuration to Environment ---",
    'log_action "Exporting configuration as environment variables..."',
    'export DEVICE_ID="__DEVICE_ID__"',
    'export APARTMENT="__APARTMENT__"',
    'export APARTMENT_ID="__APARTMENT_ID__"',
    'export PROJECT="__PROJECT__"',
    'export WS_SERVER_URL="__WS_SERVER_URL__"',
    'export LOG_BUCKET_NAME="__LOG_BUCKET_NAME__"',
    'export DEVICE_UPDATE_TOKEN="__DEVICE_UPDATE_TOKEN__"',
    'export DEVICE_STATUS_UPDATE_URL="__UPDATE_STATUS_URL__"',
    'export GOOGLE_APPLICATION_CREDENTIALS="serviceAccount.json" # This will be created inside the container',
    "",
    'report_status "installing_dependencies"',
    "",
    "## --- Dependency Installation ---",
    'log_action "Installing system dependencies..."',
    "install_if_missing curl curl",
    "install_if_missing docker docker.io",
    "",
    "## --- Tailscale Installation and Setup ---",
    "if ! command -v tailscale &> /dev/null; then",
    '    log_action "Installing Tailscale..."',
    "    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null",
    "    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list >/dev/null",
    "    sudo apt-get update",
    "    sudo apt-get install -y tailscale",
    "else",
    '    log_action "Tailscale is already installed."',
    "fi",
    'log_action "Starting Tailscale and connecting to tailnet..."',
    'sudo tailscale up --authkey="__TAILSCALE_KEY__" --hostname="__SERIAL__" --accept-routes',
    "",
    'report_status "deploying_application_container"',
    "",
    "## --- Application Container Deployment ---",
    'log_action "Pulling required Docker image: __DOCKER_IMAGE__"',
    'sudo docker pull "__DOCKER_IMAGE__"',
    "",
    'CONTAINER_NAME="__CONTAINER_NAME__"',
    "log_action \"Ensuring no old container named '${CONTAINER_NAME}' exists...\"",
    "if sudo docker ps -a --format '{{.Names}}' | grep -Eq \"^${CONTAINER_NAME}$\"; then",
    '    log_action "Stopping and removing existing container: ${CONTAINER_NAME}"',
    '    sudo docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true',
    '    sudo docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true',
    "fi",
    "",
    'log_action "Starting new application container: ${CONTAINER_NAME}"',
    "sudo docker run -d \\",
    '    --name "${CONTAINER_NAME}" \\',
    "    --restart=always \\",
    "    --network=host \\",
    "    -e DEVICE_ID \\",
    "    -e APARTMENT \\",
    "    -e APARTMENT_ID \\",
    "    -e PROJECT \\",
    "    -e WS_SERVER_URL \\",
    "    -e LOG_BUCKET_NAME \\",
    "    -e DEVICE_UPDATE_TOKEN \\",
    "    -e DEVICE_STATUS_UPDATE_URL \\",
    "    -e GOOGLE_APPLICATION_CREDENTIALS \\",
    '    "__DOCKER_IMAGE__"',
    "",
    "sleep 5", // Give container a moment to start
    "if ! sudo docker ps --format '{{.Names}}' | grep -Eq \"^${CONTAINER_NAME}$\"; then",
    '    log_action "ERROR: Container ${CONTAINER_NAME} failed to start. Please check Docker logs on the device."',
    '    report_status "container_start_failed"',
    "    exit 1",
    "fi",
    "",
    "## --- Final Status Update ---",
    'report_status "provisioning_complete"',
    'log_action "--- ✅ Provisioning script execution completed successfully. ---"',
    "exit 0",
  ];

  // Replace all placeholder values
  return scriptLines
    .join("\n")
    .replace(/__DEVICE_ID__/g, deviceId)
    .replace(/__SERIAL__/g, serial)
    .replace(/__APARTMENT__/g, apartment)
    .replace(/__APARTMENT_ID__/g, apartmentId)
    .replace(/__PROJECT__/g, project)
    .replace(/__TAILSCALE_KEY__/g, tailscaleAuthKey)
    .replace(/__DOCKER_IMAGE__/g, DEVICE_DOCKER_IMAGE)
    .replace(/__CONTAINER_NAME__/g, containerName)
    .replace(/__WS_SERVER_URL__/g, WS_SERVER_URL || "")
    .replace(/__LOG_BUCKET_NAME__/g, LOG_BUCKET_NAME || "")
    .replace(/__DEVICE_UPDATE_TOKEN__/g, DEVICE_UPDATE_TOKEN || "")
    .replace(/__UPDATE_STATUS_URL__/g, UPDATE_STATUS_URL);
}

exports.getProvisionScript = onRequest(
  {
    region: "europe-west1",
    secrets: ["TAILSCALE_API_KEY", "DEVICE_UPDATE_TOKEN"],
  },
  async (req, res) => {
    const functionName = "getProvisionScript";
    const startTimestamp = Date.now();
    logger.info({
      message: "Function execution started.",
      functionName,
      ip: req.ip,
    });

    if (req.method !== "GET") {
      logger.warn({
        message: "Method not allowed.",
        functionName,
        method: req.method,
      });
      res.setHeader("Allow", "GET");
      return res.status(405).send("Method Not Allowed");
    }

    if (!DEVICE_DOCKER_IMAGE || !UPDATE_STATUS_URL) {
      logger.error(
        "FATAL: Server configuration incomplete. DEVICE_DOCKER_IMAGE or DEVICE_STATUS_UPDATE_URL is missing from environment.",
        { functionName }
      );
      return res
        .status(500)
        .send("Internal Server Error: Server configuration is incomplete.");
    }

    const deviceHash = req.query.device_hash;
    if (!deviceHash || !/^[a-f0-9]{64}$/i.test(deviceHash)) {
      logger.warn({
        message: "Invalid or missing 'device_hash' parameter.",
        functionName,
        providedHash: deviceHash,
      });
      return res.status(400).send("Bad Request: Invalid 'device_hash' format.");
    }

    try {
      const devicesRef = db.collection("devices");
      const snapshot = await devicesRef
        .where("hash", "==", deviceHash)
        .limit(1)
        .get();

      if (snapshot.empty) {
        logger.warn({
          message: "Device hash not found.",
          functionName,
          hashPrefix: deviceHash.substring(0, 8),
        });
        return res.status(403).send("Unauthorized device: Hash not found.");
      }

      const doc = snapshot.docs[0];
      const deviceId = doc.id;
      const deviceData = doc.data();
      const {
        serial,
        approvedForProvisioning,
        identity,
        lastProvisionRequest,
      } = deviceData;

      if (approvedForProvisioning !== true) {
        logger.warn({
          message: "Device provisioning request denied (not approved).",
          functionName,
          deviceId,
          serial,
        });
        await doc.ref.update({
          provisioningStatus: "approval_pending_request_received",
        });
        return res
          .status(403)
          .send("Unauthorized: Device provisioning has not been approved.");
      }

      if (
        lastProvisionRequest &&
        (new Date() - lastProvisionRequest.toDate()) / 1000 < 60
      ) {
        logger.warn({
          message: "Device Rate Limit hit.",
          functionName,
          deviceId,
          serial,
        });
        return res
          .status(429)
          .send("Provisioning was requested recently. Please wait.");
      }

      const tailscaleAuthKey = await generateTailscaleKey(serial);

      await doc.ref.update({
        provisioningStatus: "generating_script",
        lastProvisionRequest: FieldValue.serverTimestamp(),
        lastProvisionIP: req.ip,
      });

      const script = generateScript({
        deviceId,
        serial: serial || `unassigned-sn-${deviceId.substring(0, 4)}`,
        apartment: identity?.APARTMENT || "Unassigned Apartment",
        apartmentId:
          identity?.APARTMENT_ID || `unassigned-id-${deviceId.substring(0, 4)}`,
        project: identity?.PROJECT || "Unassigned Project",
        tailscaleAuthKey,
        containerName: "bacnet-reader-service",
      });

      logger.info({
        message: "Provisioning script generated successfully.",
        functionName,
        deviceId,
        serial,
      });
      res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="provision-${serial || deviceId}.sh"`
      );
      res.status(200).send(script);
    } catch (error) {
      logger.error({
        message: "Fatal error during script generation.",
        functionName,
        error: error.message,
        stack: error.stack,
      });
      res
        .status(500)
        .send("Internal Server Error. Failed to generate provisioning script.");
    } finally {
      logger.info({
        message: "Function execution finished.",
        functionName,
        executionTimeMs: Date.now() - startTimestamp,
      });
    }
  }
);
