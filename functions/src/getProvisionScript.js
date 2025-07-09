// functions/src/getProvisionScript.js

const functions = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const fetch = require("node-fetch");
const crypto = require("crypto");
const { admin, db, rtdb } = require("../firebaseClient");
const { FieldValue } = require("firebase-admin/firestore");

// --- Configuration ---
const DEVICE_PROVISION_RATE_LIMIT_SECONDS = parseInt(
  process.env.DEVICE_RATE_LIMIT_S || "60",
  10
);
const IP_RATE_LIMIT_SECONDS = parseInt(process.env.IP_RATE_LIMIT_S || "5", 10);
const RTDB_IP_LIMIT_PATH =
  process.env.RTDB_IP_LIMIT_PATH || "provisioningIpRateLimits";
const TAILSCALE_API_KEY = process.env.TAILSCALE_API_KEY;
const TAILNET = process.env.TAILSCALE_TAILNET || "missing-tailnet.ts.net";
const TAILSCALE_KEY_EXPIRY_SECONDS = parseInt(
  process.env.TS_KEY_EXPIRY_S || "600",
  10
);
const TAILSCALE_TAG = process.env.TAILSCALE_PROVISION_TAG || "tag:provisioned";
const DEVICE_DOCKER_IMAGE = process.env.DEVICE_DOCKER_IMAGE; // Now read from .env
const FIREB_API_KEY = process.env.FIREB_API_KEY;
const FIREBASE_PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;
const FIREBASE_AUTH_DOMAIN =
  process.env.FIREBASE_AUTH_DOMAIN || `${FIREBASE_PROJECT_ID}.firebaseapp.com`;
const UPDATE_STATUS_URL = process.env.UPDATE_STATUS_URL;

/**
 * Helper to generate a Tailscale auth key.
 */
async function generateTailscaleKey(serial) {
  const functionName = "generateTailscaleKey";
  if (!TAILSCALE_API_KEY) {
    logger.error({
      message:
        "Tailscale API key (TAILSCALE_API_KEY secret) is not configured.",
      functionName,
      suggestion:
        "Ensure the secret is populated with a valid Tailscale API Key (starts with tskey-api-).",
    });
    throw new Error("Configuration Error: Tailscale API key missing.");
  }
  if (!TAILNET || TAILNET === "missing-tailnet.ts.net") {
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
  };

  logger.info({
    message: "Generating Tailscale Auth Key",
    functionName,
    tailnet: TAILNET,
    requestBody: body,
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
        message: "Tailscale API error generating auth key.",
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
        message: "Tailscale API response did not contain a valid Auth Key.",
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
      message:
        "Failed to generate Tailscale auth key due to an API interaction error.",
      functionName,
      serial,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sanitizes IP address for use as RTDB key.
 */
function sanitizeIpForKey(ip) {
  if (!ip) {
    logger.warn("sanitizeIpForKey called with null or undefined IP.");
    return "unknown-ip";
  }
  return String(ip)
    .replace(/[.#$[\]/]/g, "-")
    .replace(/:/g, "-");
}

exports.getProvisionScript = functions.onRequest(
  { region: "europe-west1", secrets: ["TAILSCALE_API_KEY", "FIREB_API_KEY"] },
  async (req, res) => {
    const functionName = "getProvisionScript";
    const startTimestamp = Date.now();
    logger.info({ message: "Function execution started.", functionName, method: req.method, ip: req.ip });

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).send("Method Not Allowed");
    }

    if (!UPDATE_STATUS_URL || !DEVICE_DOCKER_IMAGE) {
        logger.error("FATAL: Server configuration is incomplete. Required environment variables are missing.", {
            hasUpdateUrl: !!UPDATE_STATUS_URL,
            hasDockerImage: !!DEVICE_DOCKER_IMAGE
        });
        return res.status(500).send("Internal Server Error: Server configuration is incomplete.");
    }

    const requestIp = req.ip;
    if (requestIp) {
      const ipRateLimitRef = rtdb.ref(
        `${RTDB_IP_LIMIT_PATH}/${sanitizeIpForKey(requestIp)}`
      );
      try {
        const ipSnapshot = await ipRateLimitRef.once("value");
        if (
          ipSnapshot.val() &&
          (Date.now() - ipSnapshot.val()) / 1000 < IP_RATE_LIMIT_SECONDS
        ) {
          logger.warn({
            message: "IP Rate Limit hit.",
            functionName,
            requestIp,
          });
          return res
            .status(429)
            .send("Too many requests from this IP address.");
        }
        await ipRateLimitRef.set(Date.now());
      } catch (error) {
        logger.error({
          message: "Error during IP rate limit check.",
          functionName,
          requestIp,
          error: error.message,
        });
        return res
          .status(500)
          .send("Internal server error during rate limit check.");
      }
    }

    const deviceHash = req.query.device_hash;
    if (!deviceHash || !/^[a-f0-9]{64}$/i.test(deviceHash)) {
      logger.warn({
        message: "Invalid or missing 'device_hash' parameter.",
        functionName,
        requestIp,
        providedHash: deviceHash,
      });
      return res.status(400).send("Invalid 'device_hash' format.");
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
          requestIp,
          hashPrefix: deviceHash.substring(0, 8),
        });
        return res.status(403).send("Unauthorized device: Hash not found.");
      }

      const doc = snapshot.docs[0];
      const deviceId = doc.id;
      const deviceData = doc.data();
      const { serial, approvedForProvisioning, lastProvisionRequest } =
        deviceData;

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

      if (!serial) {
        logger.error({
          message: "Device document missing 'serial' field.",
          functionName,
          deviceId,
        });
        return res
          .status(500)
          .send("Internal configuration error: Device serial missing.");
      }

      if (
        lastProvisionRequest &&
        (new Date() - lastProvisionRequest.toDate()) / 1000 <
          DEVICE_PROVISION_RATE_LIMIT_SECONDS
      ) {
        logger.warn({
          message: "Device Rate Limit hit.",
          functionName,
          deviceId,
          serial,
        });
        return res
          .status(429)
          .send(
            "Provisioning for this device was requested recently. Please wait."
          );
      }

      const provisioningInstanceUuid = crypto.randomUUID();
      await doc.ref.update({
        provisioningStatus: "script_generated",
        lastProvisionRequest: FieldValue.serverTimestamp(),
        uuid: provisioningInstanceUuid,
        lastProvisionIP: requestIp || "emulator",
      });

      const firebaseToken = await admin
        .auth()
        .createCustomToken(deviceId, {
          serial,
          provisioningInstanceUuid,
          deviceId,
        });
      const tailscaleAuthKey = await generateTailscaleKey(serial);
      const containerName = "bacnet-service";

      const scriptLines = [
        "#!/bin/bash",
        "set -euo pipefail",
        "log_action() { echo \"[PROV-SCRIPT] [$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $1\"; }",
        'log_action "--- 🚀 Starting Full Provisioning Process ---"',
        "export DEBIAN_FRONTEND=noninteractive",
        'export DEVICE_SERIAL="__SERIAL__"',
        'export DEVICE_ID="__DEVICE_ID__"',
        'export PROVISIONING_INSTANCE_UUID="__PROVISIONING_INSTANCE_UUID__"',
        'export FIREBASE_UID="__FIREBASE_UID__"',
        'export FIREBASE_CUSTOM_TOKEN="__FIREBASE_CUSTOM_TOKEN__"',
        'export FIREBASE_API_KEY="__FIREB_API_KEY__"',
        'export FIREBASE_PROJECT_ID="__FIREBASE_PROJECT_ID__"',
        'export FIREBASE_AUTH_DOMAIN="__FIREBASE_AUTH_DOMAIN__"',
        'export DOCKER_IMAGE="__DOCKER_IMAGE__"',
        'export UPDATE_STATUS_URL="__UPDATE_STATUS_URL__"',
        "",
        "## --- Helper Functions ---",
        "start_service() {",
        "    local service_name=$1",
        "    if [ -d /run/systemd/system ]; then",
        "        log_action \"Systemd detected. Starting/enabling service '${service_name}' with systemctl.\"",
        '        sudo systemctl enable --now "${service_name}"',
        "    else",
        "        log_action \"No systemd detected. Starting service '${service_name}' directly.\"",
        '        case "${service_name}" in',
        "            sshd)",
        "                sudo mkdir -p /run/sshd",
        "                sudo /usr/sbin/sshd",
        "                ;;",
        "            docker)",
        "                sudo dockerd > /dev/null 2>&1 &",
        "                ;;",
        "            tailscaled)",
        "                sudo tailscaled > /dev/null 2>&1 &",
        "                ;;",
        "            nxserver.service)",
        "                sudo /usr/NX/bin/nxserver --startup",
        "                ;;",
        "            *)",
        "                log_action \"WARNING: Unknown service '${service_name}' for non-systemd environment.\"",
        "                ;;",
        "        esac",
        "    fi",
        "}",
        "install_if_missing() {",
        '    local pkg_name="$1"',
        '    if ! dpkg -l | grep -q "^ii.*$pkg_name"; then',
        "        log_action \"Package '$pkg_name' not found. Installing...\"",
        '        sudo apt-get update -y && sudo apt-get install -y "$pkg_name"',
        "    else",
        "        log_action \"Package '$pkg_name' is already installed.\"",
        "    fi",
        "}",
        "install_tailscale() {",
        "    if ! command -v tailscale &> /dev/null; then",
        '        log_action "Tailscale not found. Performing full installation..."',
        "        install_if_missing curl curl",
        "        curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg > /dev/null",
        "        curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list",
        "        sudo apt-get update",
        "        sudo apt-get install -y tailscale",
        "    else",
        '        log_action "Tailscale is already installed."',
        "    fi",
        "}",
        "",
        "## --- Dependency Installation ---",
        "install_if_missing curl",
        "install_if_missing wget",
        "install_if_missing file",
        "install_if_missing docker.io",
        "install_tailscale",
        "",
        "## --- Service Startup: SSH ---",
        "install_if_missing openssh-server",
        "start_service sshd",
        "",
        "## --- Service Startup: NoMachine ---",
        "ARCH=$(uname -m)",
        'log_action "Detected Architecture: ${ARCH}"',
        'if [[ "${ARCH}" == "x86_64" ]]; then NOMACHINE_URL="https://download.nomachine.com/download/9.0/Linux/nomachine_9.0.188_11_amd64.deb"; elif [[ "${ARCH}" == "aarch64" ]]; then NOMACHINE_URL="https://download.nomachine.com/download/9.0/Linux/nomachine_9.0.188_11_arm64.deb"; else NOMACHINE_URL=""; fi',
        'if [[ -n "${NOMACHINE_URL}" ]]; then',
        '  log_action "Installing NoMachine from ${NOMACHINE_URL}"',
        "  NOMACHINE_PKG_FILE=$(mktemp /tmp/nomachine.XXXXXX.deb)",
        '  wget --output-document="${NOMACHINE_PKG_FILE}" "${NOMACHINE_URL}"',
        '  log_action "Validating downloaded package..."',
        "  if file \"${NOMACHINE_PKG_FILE}\" | grep -q 'Debian binary package'; then",
        '    log_action "Package is a valid Debian archive. Proceeding with installation."',
        '    sudo dpkg -i "${NOMACHINE_PKG_FILE}"',
        "    sudo apt-get install -f -y",
        "    start_service nxserver.service",
        "  else",
        '    log_action "ERROR: Downloaded file is not a valid Debian package. Skipping NoMachine installation."',
        "  fi",
        '  rm -f "${NOMACHINE_PKG_FILE}"',
        "fi",
        "",
        "## --- Service Startup: Docker & Tailscale ---",
        "start_service docker",
        "start_service tailscaled",
        "sleep 5",
        'log_action "Configuring Tailscale and connecting to tailnet..."',
        'sudo tailscale up --authkey="__TAILSCALE_KEY__" --hostname="__SERIAL__" --accept-routes',
        "",
        "## --- Application Container Deployment ---",
        'log_action "Pulling required Docker image: ${DOCKER_IMAGE}..."',
        'sudo docker pull "${DOCKER_IMAGE}"',
        'CONTAINER_NAME="__CONTAINER_NAME_VAR__"',
        'if sudo docker ps -a --format \'{{.Names}}\' | grep -q "^${CONTAINER_NAME}$"; then sudo docker stop "${CONTAINER_NAME}" > /dev/null 2>&1 && sudo docker rm "${CONTAINER_NAME}" > /dev/null 2>&1; fi',
        'sudo docker run -d --name "${CONTAINER_NAME}" --restart=always --network=host -e DEVICE_SERIAL -e DEVICE_ID -e PROVISIONING_INSTANCE_UUID -e FIREBASE_UID -e FIREBASE_CUSTOM_TOKEN -e FIREBASE_API_KEY -e FIREBASE_PROJECT_ID -e FIREBASE_AUTH_DOMAIN -e DOCKER_IMAGE "${DOCKER_IMAGE}"',
        "",
        "## --- Final Status Update ---",
        'log_action "Reporting provisioning completion to the cloud..."',
        "UPDATE_PAYLOAD=$(printf '{\"deviceId\": \"%s\", \"registered\": true, \"provisioningStatus\": \"provisioning_complete\"}' \"$DEVICE_ID\")",
        "curl --fail -X POST -H \"Content-Type: application/json\" -d \"$UPDATE_PAYLOAD\" \"$UPDATE_STATUS_URL\"",
        "",
        'log_action "--- ✅ Provisioning script execution completed. ---"',
        "exit 0",
      ];

      const scriptTemplate = scriptLines.join("\n");
      const script = scriptTemplate
        .replace(/__SERIAL__/g, serial)
        .replace(/__DEVICE_ID__/g, deviceId)
        .replace(/__PROVISIONING_INSTANCE_UUID__/g, provisioningInstanceUuid)
        .replace(/__FIREBASE_UID__/g, deviceId)
        .replace(/__FIREBASE_CUSTOM_TOKEN__/g, firebaseToken)
        .replace(
          /__FIREB_API_KEY__/g,
          FIREB_API_KEY || "MISSING_API_KEY_IN_ENV"
        )
        .replace(
          /__PROJECT_ID__/g,
          FIREBASE_PROJECT_ID || "MISSING_PROJECT_ID_IN_ENV"
        )
        .replace(
          /__FIREBASE_AUTH_DOMAIN__/g,
          FIREBASE_AUTH_DOMAIN || "MISSING_AUTH_DOMAIN_IN_ENV"
        )
        .replace(/__DOCKER_IMAGE__/g, DEVICE_DOCKER_IMAGE)
        .replace(/__TAILSCALE_KEY__/g, tailscaleAuthKey)
        .replace(/__CONTAINER_NAME_VAR__/g, containerName)
        .replace(/__UPDATE_STATUS_URL__/g, UPDATE_STATUS_URL);

      logger.info({
        message: "Provisioning script generated successfully.",
        functionName,
        deviceId,
        serial,
      });
      res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="provision-${serial}.sh"`
      );
      res.status(200).send(script);
    } catch (error) {
      logger.error({
        message: "Fatal error during script generation process.",
        functionName,
        error: error.message,
        stack: error.stack,
      });
      res
        .status(500)
        .send("Internal Server Error. Failed to generate provisioning script.");
    } finally {
      const executionTime = Date.now() - startTimestamp;
      logger.info({
        message: "Function execution finished.",
        functionName,
        executionTimeMs: executionTime,
      });
    }
  }
);