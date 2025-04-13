// functions/src/getProvisionScript.js

const functions = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const fetch = require("node-fetch");
const crypto = require("crypto");
const { admin, db, rtdb} = require("../firebase");

// --- NEW: Import FieldValue directly ---
const { FieldValue } = require("firebase-admin/firestore");
// --- END NEW ---


// --- Configuration ---
const DEVICE_PROVISION_RATE_LIMIT_SECONDS = parseInt(
  process.env.DEVICE_RATE_LIMIT_S || "60",
  10
);
const IP_RATE_LIMIT_SECONDS = parseInt(process.env.IP_RATE_LIMIT_S || "5", 10);
const RTDB_IP_LIMIT_PATH =
  process.env.RTDB_IP_LIMIT_PATH || "provisioningIpRateLimits";
const TAILSCALE_API_KEY = process.env.TAILSCALE_API_KEY; // Loaded via secret mechanism
const TAILNET = process.env.TAILSCALE_TAILNET || "missing-tailnet.ts.net";
const TAILSCALE_KEY_EXPIRY_SECONDS = parseInt(
  process.env.TS_KEY_EXPIRY_S || "600",
  10
);
const TAILSCALE_TAG = process.env.TAILSCALE_PROVISION_TAG || "tag:provisioned";
const DEVICE_DOCKER_IMAGE = process.env.DEVICE_DOCKER_IMAGE || "alpine:latest"; // Fallback
const FIREB_API_KEY = process.env.FIREB_API_KEY; // Loaded via secret mechanism (renamed)
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
  if (!serial) {
    logger.warn({ message: "Serial number not provided.", functionName });
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
    expiry: TAILSCALE_KEY_EXPIRY_SECONDS,
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
        statusText: response.statusText,
        url,
        errorBody: errorText,
        requestBody: body,
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
      url,
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

// --- Cloud Function Definition ---
exports.getProvisionScript = functions.onRequest(
  {
    region: "europe-west1",
    secrets: ["TAILSCALE_API_KEY", "FIREB_API_KEY"], // Renamed API key secret
  },
  async (req, res) => {
    const functionName = "getProvisionScript";
    const startTimestamp = Date.now();
    logger.info({
      message: "Function execution started.",
      functionName,
      method: req.method,
      path: req.path,
      ip: req.ip,
      emulator: process.env.FUNCTIONS_EMULATOR,
    });

    // Method Check / IP Rate Limit (Same as before)
    if (req.method !== "GET") {
      logger.warn({
        message: "Method Not Allowed.",
        functionName,
        requestedMethod: req.method,
      });
      res.setHeader("Allow", "GET");
      return res.status(405).send("Method Not Allowed");
    }
    const requestIp = req.ip;
    if (!requestIp && process.env.FUNCTIONS_EMULATOR === "true") {
      logger.info({
        message: "Skipping IP rate limit check (Emulator mode without IP).",
        functionName,
      });
    } else if (!requestIp) {
      logger.error({
        message:
          "Could not determine request IP address in non-emulator environment.",
        functionName,
      });
      return res.status(400).send("Could not identify requester IP address.");
    } else {
      /* ... IP rate limit check logic ... */
      const sanitizedIp = sanitizeIpForKey(requestIp);
      const ipRateLimitRef = rtdb.ref(`${RTDB_IP_LIMIT_PATH}/${sanitizedIp}`);
      // logger.info({ message: "Checking IP rate limit.", functionName, requestIp, sanitizedIp });
      try {
        const ipSnapshot = await ipRateLimitRef.once("value");
        const lastRequestTimestamp = ipSnapshot.val();
        const now = Date.now();
        if (
          lastRequestTimestamp &&
          (now - lastRequestTimestamp) / 1000 < IP_RATE_LIMIT_SECONDS
        ) {
          logger.warn({
            message: "IP Rate Limit hit.",
            functionName,
            requestIp,
            sanitizedIp,
            limitSeconds: IP_RATE_LIMIT_SECONDS,
          });
          res.setHeader("Retry-After", String(IP_RATE_LIMIT_SECONDS));
          return res
            .status(429)
            .send("Too many requests from this IP address. Please wait.");
        }
        await ipRateLimitRef.set(Date.now());
        // logger.info({ message: "IP rate limit check passed, timestamp updated.", functionName, requestIp, sanitizedIp });
      } catch (error) {
        logger.error({
          message: "Error during IP rate limit check/update.",
          functionName,
          requestIp,
          sanitizedIp,
          error: error.message,
          stack: error.stack,
        });
        return res
          .status(500)
          .send("Internal server error during rate limit check.");
      }
    }

    // Device Lookup (Firestore)
    const deviceHash = req.query.device_hash;
    if (!deviceHash) {
      logger.warn({
        message: "Missing 'device_hash' query parameter.",
        functionName,
        requestIp,
      });
      return res.status(400).send("Missing 'device_hash' query parameter.");
    }
    if (!/^[a-f0-9]{64}$/i.test(deviceHash)) {
      logger.warn({
        message: "Invalid 'device_hash' format.",
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
      const deviceData = doc.data();
      const deviceId = doc.id;
      const serial = deviceData.serial;

      if (!serial) {
        logger.error({
          message: "Device document missing 'serial' field.",
          functionName,
          requestIp,
          deviceId,
          hashPrefix,
        });
        return res
          .status(500)
          .send("Internal configuration error: Device serial missing.");
      }
      logger.info({
        message: "Device found.",
        functionName,
        requestIp,
        deviceId,
        serial,
        hashPrefix,
      });

      // Per-Device Rate Limiting
      const lastProvisionRequest = deviceData.lastProvisionRequest?.toDate();
      const nowForDeviceCheck = new Date();
      if (
        lastProvisionRequest &&
        (nowForDeviceCheck - lastProvisionRequest) / 1000 <
          DEVICE_PROVISION_RATE_LIMIT_SECONDS
      ) {
        logger.warn({
          message: "Device Rate Limit hit.",
          functionName,
          requestIp,
          deviceId,
          serial,
          limitSeconds: DEVICE_PROVISION_RATE_LIMIT_SECONDS,
          lastAttempt: lastProvisionRequest.toISOString(),
        });
        res.setHeader(
          "Retry-After",
          String(DEVICE_PROVISION_RATE_LIMIT_SECONDS)
        );
        return res
          .status(429)
          .send(
            `Provisioning for device ${serial} already requested recently. Please wait.`
          );
      }
      logger.info({
        message: "Device rate limit check passed.",
        functionName,
        deviceId,
        serial,
      });

      // Generate Provisioning Instance UUID & Update Firestore
      const provisioningInstanceUuid = crypto.randomUUID();
      const updateData = {
        provisioningStatus: "script_generated",
        lastProvisionRequest: FieldValue.serverTimestamp(), // Use imported FieldValue
        uuid: provisioningInstanceUuid,
        lastProvisionIP: requestIp || "emulator",
      };
      await doc.ref.update(updateData);
      logger.info({
        message: "Updated device status in Firestore.",
        functionName,
        deviceId,
        serial,
        status: "script_generated",
        provisioningInstanceUuid,
      });

      // Generate Auth Credentials
      const firebaseUid = deviceId;
      const customTokenClaims = {
        serial: serial,
        provisioningInstanceUuid: provisioningInstanceUuid,
        deviceId: deviceId,
      };
      logger.debug({
        message: "Attempting to create custom token",
        functionName,
        firebaseUid,
        customTokenClaims,
      });
      const firebaseToken = await admin
        .auth()
        .createCustomToken(firebaseUid, customTokenClaims);
      logger.info({
        message: "Generated Firebase custom token.",
        functionName,
        deviceId,
        serial,
        firebaseUid,
      });

      // Generate Tailscale Key
      const tailscaleKey = await generateTailscaleKey(serial);

      logger.debug({
        message: "Preparing to replace script placeholders. Values:",
        functionName,
        DEVICE_DOCKER_IMAGE_CONST: DEVICE_DOCKER_IMAGE,
        DEVICE_DOCKER_IMAGE_ENV: process.env.DEVICE_DOCKER_IMAGE,
      });

      // --- Construct Provisioning Script using Placeholders ---
      // Define JS variable for container name
      const containerName = "bacnet-service";

      /* eslint-disable no-undef, no-eval */
      const scriptTemplate = `#!/bin/bash
set -e # Exit on error
set -u # Error on unset variables
# set -x # Uncomment for debug tracing

# --- Logging Helper ---
log_action() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $1"; }

log_action "🚀 Starting Provisioning Process"
log_action "   Device Serial: __SERIAL__"
log_action "   Firestore Device ID / Firebase UID: __DEVICE_ID__"
log_action "   Provisioning Instance UUID: __PROVISIONING_INSTANCE_UUID__"
log_action "   Run Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# --- Configuration (Injected by Cloud Function) ---
export DEVICE_SERIAL="__SERIAL__"
export DEVICE_ID="__DEVICE_ID__"
export PROVISIONING_INSTANCE_UUID="__PROVISIONING_INSTANCE_UUID__"
export FIREBASE_UID="__FIREBASE_UID__"
export FIREBASE_CUSTOM_TOKEN="__FIREBASE_CUSTOM_TOKEN__"
export FIREBASE_API_KEY="__FIREB_API_KEY__" # Use renamed variable
export FIREBASE_PROJECT_ID="__FIREBASE_PROJECT_ID__"
export FIREBASE_AUTH_DOMAIN="__FIREBASE_AUTH_DOMAIN__"
export DOCKER_IMAGE="__DOCKER_IMAGE__"

# --- Dependency Installation Function ---
install_if_missing() {
    local pkg_name=$1
    local install_cmd=$2
    if ! command -v "$pkg_name" &> /dev/null; then
        log_action "$pkg_name not found. Installing..."
        eval "$install_cmd"
        log_action "$pkg_name installed successfully."
    else
        log_action "$pkg_name is already installed."
    fi
}

# --- Install Core Dependencies ---
install_if_missing "docker" "curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh && rm get-docker.sh"
install_if_missing "tailscale" "curl -fsSL https://tailscale.com/install.sh | sh"

# --- Service Management (Ensure Docker is running) ---
if ! systemctl is-active --quiet docker; then log_action "Starting Docker service..."; systemctl start docker; fi
if ! systemctl is-enabled --quiet docker; then log_action "Enabling Docker service to start on boot..."; systemctl enable docker; fi

# --- Tailscale Configuration ---
log_action "Configuring Tailscale and connecting to tailnet..."
tailscale up \\
    --authkey "__TAILSCALE_KEY__" \\
    --hostname "__SERIAL__" \\
    --accept-routes
log_action "Tailscale configured and connected."

# --- Docker Container Setup ---
# Use escaped \${DOCKER_IMAGE} for Bash variable expansion
log_action "Pulling required Docker image: \${DOCKER_IMAGE}..."
docker pull "\${DOCKER_IMAGE}"

# Define the container name variable in Bash
CONTAINER_NAME="__CONTAINER_NAME_VAR__"

# Use escaped \${CONTAINER_NAME} for Bash variable expansion
log_action "Stopping and removing any existing container named '\${CONTAINER_NAME}'..."
docker stop "\${CONTAINER_NAME}" > /dev/null 2>&1 || true
docker rm "\${CONTAINER_NAME}" > /dev/null 2>&1 || true

log_action "Starting Docker container '\${CONTAINER_NAME}'..."
docker run -d \\
    --name "\${CONTAINER_NAME}" \\ # Use Bash variable for --name
    --restart=always \\
    --network=host \\
    # Pass exported variables into the container's environment
    -e DEVICE_SERIAL \\
    -e DEVICE_ID \\
    -e PROVISIONING_INSTANCE_UUID \\
    -e FIREBASE_UID \\
    -e FIREBASE_CUSTOM_TOKEN \\
    -e FIREBASE_API_KEY \\
    -e FIREBASE_PROJECT_ID \\
    -e FIREBASE_AUTH_DOMAIN \\
    -e DOCKER_IMAGE \\ # Pass DOCKER_IMAGE into container env if needed
    "\${DOCKER_IMAGE}" # Use Bash variable for the image name

log_action "Docker container '\${CONTAINER_NAME}' started."

# --- Final Steps & Cleanup ---
log_action "✅ Provisioning script execution completed."
log_action "   Container '\${CONTAINER_NAME}' is starting in the background."
log_action "   Monitor container logs ('docker logs \${CONTAINER_NAME}') and Firebase Firestore for operational status updates."

exit 0
`; // End of script template
      /* eslint-enable no-undef, no-eval */

      // --- Replace Placeholders in Template ---
      const script = scriptTemplate
        .replace(/__SERIAL__/g, serial)
        .replace(/__DEVICE_ID__/g, deviceId)
        .replace(/__PROVISIONING_INSTANCE_UUID__/g, provisioningInstanceUuid)
        .replace(/__FIREBASE_UID__/g, firebaseUid)
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
        .replace(/__DOCKER_IMAGE__/g, DEVICE_DOCKER_IMAGE) // Replace Docker image placeholder
        .replace(/__TAILSCALE_KEY__/g, tailscaleKey)
        .replace(/__CONTAINER_NAME_VAR__/g, containerName); // Replace container name placeholder

      logger.info({
        message: "Provisioning script generated successfully.",
        functionName,
        deviceId,
        serial,
      });

      // Return Script
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
