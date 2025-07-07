// functions/src/updateDeviceStatus.js
const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../firebaseClient");
const logger = require("firebase-functions/logger");
require("dotenv").config();

// Load the access token from secrets or .env for local testing
const FORCE_NO_TOKEN_CHECK = process.env.FORCE_NO_TOKEN_CHECK === "true";
const ACCESS_TOKEN = process.env.DEVICE_UPDATE_TOKEN;

/**
 * An HTTP-triggered function that allows a provisioned device to update its status
 * and state in Firestore.
 */
exports.updateDeviceStatus = async (req, res) => {
  const functionName = "updateDeviceStatus";
  logger.info({ message: "Function execution started.", functionName, ip: req.ip });

  // 1. Basic validation and security checks
  if (req.method !== "POST") {
    logger.warn({ message: "Method Not Allowed.", functionName, method: req.method });
    return res.status(405).send("Method Not Allowed");
  }

  if (!FORCE_NO_TOKEN_CHECK) {
    // Note: A more secure method would be for the device to sign in with its custom token
    // and then pass the resulting Firebase ID Token in the Authorization header.
    // The Admin SDK could then verify this token. For now, we use a shared secret.
    const token = req.headers.authorization?.split("Bearer ")[1] || req.body.token;
    if (!token || token !== ACCESS_TOKEN) {
      logger.error({ message: "Forbidden: Invalid or missing access token.", functionName });
      return res.status(403).send("Forbidden: Invalid access token.");
    }
  } else {
    logger.info({ message: "Token check bypassed (local/testing mode).", functionName });
  }

  // 2. Extract and validate payload
  const { deviceId, state, registered, provisioningStatus } = req.body;
  if (!deviceId) {
    logger.error({ message: "Bad Request: Missing 'deviceId' in payload.", functionName, body: req.body });
    return res.status(400).send("Bad Request: Missing required parameter 'deviceId'.");
  }

  logger.info({ message: `Processing update for deviceId: ${deviceId}` , functionName });

  try {
    const deviceRef = db.collection("devices").doc(deviceId);

    // 3. Construct the update object dynamically
    // We will use dot notation to update nested fields within the 'state' map.
    const updatePayload = {
      // Always update the 'lastUpdate' timestamp inside the 'state' map
      "state.lastUpdate": FieldValue.serverTimestamp(),
    };

    // Add other state fields if they are present in the request
    if (state && typeof state === "object") {
      for (const key in state) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          // Avoid updating lastUpdate again if it was in the state object
          if (key !== "lastUpdate") {
            updatePayload[`state.${key}`] = state[key];
          }
        }
      }
    }

    // Update top-level fields like 'registered' status if present
    if (typeof registered === "boolean") {
      updatePayload.registered = registered;
    }
    
    // Update top-level 'provisioningStatus' if present
    if (provisioningStatus) {
        updatePayload.provisioningStatus = provisioningStatus;
    }

    // 4. Perform the Firestore update
    await deviceRef.update(updatePayload);

    logger.info({ message: "Device status updated successfully.", functionName, deviceId, updatePayload });
    return res.status(200).json({
      message: "Device status updated successfully.",
      deviceId: deviceId,
    });

  } catch (error) {
    // Handle cases where the deviceId doesn't exist or other Firestore errors
    if (error.code === 5) { // Firestore 'NOT_FOUND' error code
      logger.error({ message: `Device with ID '${deviceId}' not found.`, functionName, error: error.message });
      return res.status(404).json({ error: `Device with ID '${deviceId}' not found.` });
    }
    logger.error({ message: "Error updating device status.", functionName, deviceId, error: error.message, stack: error.stack });
    return res.status(500).json({ error: "Internal Server Error", details: error.toString() });
  }
};