// functions/src/updateDeviceStatus.js
const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../firebaseAdmin");
const logger = require("firebase-functions/logger");

// Use a centralized config for this token
const { config } = require("./config");

const FORCE_NO_TOKEN_CHECK = process.env.FORCE_NO_TOKEN_CHECK === "true";

exports.updateDeviceStatus = async (req, res) => {
  const functionName = "updateDeviceStatus";
  logger.info({ message: "Function execution started.", functionName, ip: req.ip });

  if (req.method !== "POST") {
    logger.warn({ message: "Method Not Allowed.", functionName, method: req.method });
    return res.status(405).send("Method Not Allowed");
  }

  const token = req.headers.authorization?.split("Bearer ")[1];
  const secrets = config.getSecrets(); // Load secrets using our config module
  
  if (!FORCE_NO_TOKEN_CHECK && (!token || token !== secrets.deviceUpdateToken)) {
      logger.error({ message: "Forbidden: Invalid or missing access token.", functionName });
      return res.status(403).send("Forbidden: Invalid access token.");
  }

  const { deviceId, provisioningStatus, state } = req.body;
  if (!deviceId) {
    logger.error({ message: "Bad Request: Missing 'deviceId' in payload.", functionName, body: req.body });
    return res.status(400).send("Bad Request: Missing required parameter 'deviceId'.");
  }

  logger.info({ message: `Processing update for deviceId: ${deviceId}` , functionName, status: provisioningStatus });

  try {
    const deviceRef = db.collection("devices").doc(deviceId);

    const updatePayload = {
      "state.lastUpdate": FieldValue.serverTimestamp(),
      "provisioning.lastReportedStatus": provisioningStatus || "unknown",
      "provisioning.lastReportedAt": FieldValue.serverTimestamp(),
    };

    // If the provisioning script is reporting a status, update the top-level field
    if (provisioningStatus) {
        updatePayload.provisioningStatus = provisioningStatus;
    }

    // --- NEW LOGIC: Handle the final provisioning step ---
    if (provisioningStatus === "provisioning_complete") {
        logger.info({ message: `Provisioning complete for ${deviceId}. Setting initial active state.`, functionName });
        updatePayload['state.service_status'] = 'starting';
        updatePayload['state.connectivity_status'] = 'connecting';
        updatePayload['identity.commissioned'] = true; // Mark as commissioned
    }
    // --- END NEW LOGIC ---

    // If the device's main service is sending a full state update, merge it.
    if (state && typeof state === "object") {
      for (const key in state) {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          if (key !== "lastUpdate") { // Avoid redundant timestamp
            updatePayload[`state.${key}`] = state[key];
          }
        }
      }
    }

    await deviceRef.update(updatePayload);

    logger.info({ message: "Device status updated successfully.", functionName, deviceId });
    return res.status(200).json({
      message: "Device status updated successfully.",
      deviceId: deviceId,
    });

  } catch (error) {
    if (error.code === 5) {
      logger.error({ message: `Device with ID '${deviceId}' not found.`, functionName, error: error.message });
      return res.status(404).json({ error: `Device with ID '${deviceId}' not found.` });
    }
    logger.error({ message: "Error updating device status.", functionName, deviceId, error: error.message, stack: error.stack });
    return res.status(500).json({ error: "Internal Server Error", details: error.toString() });
  }
};