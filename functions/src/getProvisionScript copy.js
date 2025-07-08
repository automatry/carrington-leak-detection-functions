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
const DEVICE_DOCKER_IMAGE = process.env.DEVICE_DOCKER_IMAGE || "alpine:latest";
const FIREB_API_KEY = process.env.FIREB_API_KEY;
const FIREBASE_PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;
const FIREBASE_AUTH_DOMAIN =
  process.env.FIREBASE_AUTH_DOMAIN || `${FIREBASE_PROJECT_ID}.firebaseapp.com`;

/**
 * Helper to generate a Tailscale auth key.
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
          preauthorized: true,
          ephemeral: false,
          reusable: false,
          tags: [TAILSCALE_TAG],
        },
      },
    },
    expirySeconds: TAILSCALE_KEY_EXPIRY_SECONDS,
  };

  logger.info({
    message: "Generating Tailscale key",
    functionName,
    tailnet: TAILNET,
    tag: TAILSCALE_TAG,
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

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({
        message: "Tailscale API error generating auth key.",
        functionName,
        serial,
        status: response.status,
        errorBody: errorText,
      });
      throw new Error(
        `Tailscale API error (${response.status}): ${response.statusText}`
      );
    }

    const data = await response.json();
    if (!data.key) {
      logger.error({
        message: "Tailscale API response missing 'key'.",
        functionName,
        serial,
        responseData: data,
      });
      throw new Error("Tailscale API did not return an auth key.");
    }

    logger.info({
      message: "Tailscale key generated successfully.",
      functionName,
      serial,
      keyId: data.id,
    });
    return data.key;
  } catch (error) {
    logger.error({
      message: "Failed to generate Tailscale key due to API interaction error.",
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
    logger.info({
      message: "Function execution started.",
      functionName,
      method: req.method,
      ip: req.ip,
    });

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).send("Method Not Allowed");
    }

    const requestIp = req.ip;
    if (requestIp) {
      const sanitizedIp = sanitizeIpForKey(requestIp);
      const ipRateLimitRef = rtdb.ref(`${RTDB_IP_LIMIT_PATH}/${sanitizedIp}`);
      try {
        const ipSnapshot = await ipRateLimitRef.once("value");
        const lastRequestTimestamp = ipSnapshot.val();
        if (
          lastRequestTimestamp &&
          (Date.now() - lastRequestTimestamp) / 1000 < IP_RATE_LIMIT_SECONDS
        ) {
          logger.warn({
            message: "IP Rate Limit hit.",
            functionName,
            requestIp,
          });
          res.setHeader("Retry-After", String(IP_RATE_LIMIT_SECONDS));
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

    const hashPrefix = deviceHash.substring(0, 8);
    logger.info({
      message: "Looking up device by hash.",
      functionName,
      requestIp,
      hashPrefix,
    });

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
          hashPrefix,
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
      logger.info({
        message: "Device is approved for provisioning.",
        functionName,
        deviceId,
      });

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
      logger.info({ message: "Device found.", functionName, deviceId, serial });

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
        res.setHeader(
          "Retry-After",
          String(DEVICE_PROVISION_RATE_LIMIT_SECONDS)
        );
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
      logger.info({
        message: "Updated device status in Firestore.",
        functionName,
        deviceId,
        serial,
      });

      // --- Custom Token Generation with Specific Error Handling ---
      let firebaseToken;
      try {
        const firebaseUid = deviceId;
        const customTokenClaims = {
          serial,
          provisioningInstanceUuid,
          deviceId,
        };
        logger.info({
          message: "Attempting to create Firebase custom token.",
          functionName,
          firebaseUid,
          customTokenClaims,
        });
        firebaseToken = await admin
          .auth()
          .createCustomToken(firebaseUid, customTokenClaims);
        logger.info({
          message: "Generated Firebase custom token successfully.",
          functionName,
          deviceId,
        });
      } catch (tokenError) {
        // This will now catch the specific IAM permission error and log it clearly.
        logger.error({
          message:
            "FATAL: Failed to create Firebase custom token. This is likely an IAM permission issue.",
          functionName,
          deviceId,
          error: tokenError.message,
          code: tokenError.code,
          suggestion:
            "Ensure the function's service account has the 'Service Account Token Creator' role.",
        });
        throw tokenError; // Re-throw to be caught by the main catch block and return a 500 error.
      }
      // --- End Custom Token Generation ---

      const tailscaleKey = await generateTailscaleKey(serial);
      const containerName = "bacnet-service";

      // --- Corrected Bash Script Template ---
      const scriptTemplate = `#!/bin/bash
set -e
set -u
# set -x # Uncomment for deep debug tracing

log_action() { echo "[PROV-SCRIPT] [$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"; }

log_action "--- 🚀 Starting Full Provisioning Process ---"
log_action "Device Serial: __SERIAL__"
log_action "Firestore Device ID / Firebase UID: __DEVICE_ID__"
log_action "Provisioning Instance UUID: __PROVISIONING_INSTANCE_UUID__"

export DEVICE_SERIAL="__SERIAL__"
export DEVICE_ID="__DEVICE_ID__"
export PROVISIONING_INSTANCE_UUID="__PROVISIONING_INSTANCE_UUID__"
export FIREBASE_UID="__FIREBASE_UID__"
export FIREBASE_CUSTOM_TOKEN="__FIREBASE_CUSTOM_TOKEN__"
export FIREBASE_API_KEY="__FIREB_API_KEY__"
export FIREBASE_PROJECT_ID="__FIREBASE_PROJECT_ID__"
export FIREBASE_AUTH_DOMAIN="__FIREBASE_AUTH_DOMAIN__"
export DOCKER_IMAGE="__DOCKER_IMAGE__"

install_if_missing() {
    local pkg_name=$1
    local install_cmd=$2
    if ! command -v "$pkg_name" &> /dev/null; then
        log_action "Dependency '$pkg_name' not found. Installing..."
        sudo apt-get update -y && sudo apt-get install -y "$install_cmd"
    else
        log_action "Dependency '$pkg_name' is already installed."
    fi
}

install_if_missing "docker" "docker.io"
install_if_missing "tailscale" "tailscale"

log_action "Ensuring Docker service is active and enabled."
sudo systemctl enable --now docker

log_action "Configuring Tailscale and connecting to tailnet..."
sudo tailscale up \\
    --authkey="__TAILSCALE_KEY__" \\
    --hostname="__SERIAL__" \\
    --accept-routes
log_action "Tailscale configured and connected."

log_action "Pulling required Docker image: \${DOCKER_IMAGE}..."
sudo docker pull "\${DOCKER_IMAGE}"

CONTAINER_NAME="__CONTAINER_NAME_VAR__"

log_action "Stopping and removing any existing container named '\${CONTAINER_NAME}'..."
sudo docker stop "\${CONTAINER_NAME}" > /dev/null 2>&1 || true
sudo docker rm "\${CONTAINER_NAME}" > /dev/null 2>&1 || true

log_action "Starting new Docker container '\${CONTAINER_NAME}'..."
sudo docker run -d \\
    --name "\${CONTAINER_NAME}" \\
    --restart=always \\
    --network=host \\
    -e DEVICE_SERIAL \\
    -e DEVICE_ID \\
    -e PROVISIONING_INSTANCE_UUID \\
    -e FIREBASE_UID \\
    -e FIREBASE_CUSTOM_TOKEN \\
    -e FIREBASE_API_KEY \\
    -e FIREBASE_PROJECT_ID \\
    -e FIREBASE_AUTH_DOMAIN \\
    -e DOCKER_IMAGE \\
    "\${DOCKER_IMAGE}"

log_action "Docker container '\${CONTAINER_NAME}' started."
log_action "--- ✅ Provisioning script execution completed. ---"
exit 0
`;

      const script = scriptTemplate
        .replace(/__SERIAL__/g, serial)
        .replace(/__DEVICE_ID__/g, deviceId)
        .replace(/__PROVISIONING_INSTANCE_UUID__/g, provisioningInstanceUuid)
        .replace(/__FIREBASE_UID__/g, deviceId) // Firebase UID is the deviceId
        .replace(/__FIREBASE_CUSTOM_TOKEN__/g, firebaseToken)
        .replace(
          /__FIREB_API_KEY__/g,
          FIREB_API_KEY || "MISSING_API_KEY_IN_ENV"
        )
        .replace(
          /__FIREBASE_PROJECT_ID__/g,
          FIREBASE_PROJECT_ID || "MISSING_PROJECT_ID_IN_ENV"
        )
        .replace(
          /__FIREBASE_AUTH_DOMAIN__/g,
          FIREBASE_AUTH_DOMAIN || "MISSING_AUTH_DOMAIN_IN_ENV"
        )
        .replace(/__DOCKER_IMAGE__/g, DEVICE_DOCKER_IMAGE)
        .replace(/__TAILSCALE_KEY__/g, tailscaleKey)
        .replace(/__CONTAINER_NAME_VAR__/g, containerName);

      logger.info({
        message: "Provisioning script generated successfully.",
        functionName,
        deviceId,
        serial,
      });

      res.setHeader("Content-Type", "text/x-shellscript");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="provision-${serial}.sh"`
      );
      res.status(200).send(script);
    } catch (error) {
      logger.error({
        message: "Fatal error during script generation process.",
        functionName,
        requestIp,
        hashPrefix,
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
