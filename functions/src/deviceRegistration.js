// functions/src/deviceRegistration.js
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const { db } = require("../firebaseClient");
const { FieldValue } = require("firebase-admin/firestore");

/**
 * Creates a SHA-256 hash of a given string.
 * @param {string} input The string to hash.
 * @returns {string} The hexadecimal hash string.
 */
function createHash(input) {
  if (!input) return "";
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * registerDevice - Handles the initial self-registration call from a new device.
 * It expects a `serial` number in the POST body. If the device doesn't exist,
 * it creates a new record. If it does, it simply returns the existing record's info.
 */
const registerDevice = onRequest(
  { region: "europe-west1", cors: true }, // Enable CORS for easy testing
  async (req, res) => {
    const functionName = "registerDevice";

    // Allow pre-flight requests for CORS
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }

    if (req.method !== "POST") {
      logger.warn({ message: "Method Not Allowed.", functionName, method: req.method });
      res.setHeader("Allow", "POST");
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const { serial } = req.body;
      if (!serial || typeof serial !== "string" || serial.trim() === "") {
        logger.error({ message: "Bad Request: Serial number is missing or invalid.", functionName, body: req.body });
        return res.status(400).send("Bad Request: 'serial' is required.");
      }
      const trimmedSerial = serial.trim();
      logger.info({ message: `Registration request for serial: ${trimmedSerial}`, functionName, ip: req.ip });

      const devicesRef = db.collection("devices");
      const q = devicesRef.where("serial", "==", trimmedSerial).limit(1);
      const snapshot = await q.get();

      if (!snapshot.empty) {
        const existingDoc = snapshot.docs[0];
        await existingDoc.ref.update({ lastSeen: FieldValue.serverTimestamp() });
        logger.info({ message: `Existing device found. ID: ${existingDoc.id}. Responding with existing data.`, functionName, serial: trimmedSerial });
        return res.status(200).json({
          deviceId: existingDoc.id,
          status: existingDoc.data().provisioningStatus || "unknown",
        });
      }

      logger.info({ message: `New device. Creating record for serial: ${trimmedSerial}`, functionName });
      const newDeviceHash = createHash(trimmedSerial);
      const newDeviceData = {
        serial: trimmedSerial,
        hash: newDeviceHash,
        friendlyName: `Device ${trimmedSerial}`,
        registered: false,
        approvedForProvisioning: false,
        provisioningStatus: "awaiting_approval",
        identity: { commissioned: false, APARTMENT: `Awaiting Approval (${trimmedSerial})`, PROJECT: "Unassigned" },
        state: { connectivity_status: "unknown", leak_status: "unknown" },
        config: { flags: { enable_bacnet: true, enable_leak_detection: true }},
        createdAt: FieldValue.serverTimestamp(),
        lastSeen: FieldValue.serverTimestamp(),
      };

      const docRef = await devicesRef.add(newDeviceData);
      logger.info({ message: `New device created successfully. ID: ${docRef.id}`, functionName, serial: trimmedSerial });

      return res.status(201).json({
        deviceId: docRef.id,
        status: "awaiting_approval",
      });

    } catch (error) {
      logger.error({ message: "Internal server error during device registration.", functionName, error: error.message, stack: error.stack });
      return res.status(500).send("Internal Server Error");
    }
  }
);

/**
 * checkDeviceStatus - Handles polling calls from a device waiting for approval.
 * It expects a `deviceId` as a query parameter.
 */
const checkDeviceStatus = onRequest(
  { region: "europe-west1", cors: true }, // Enable CORS
  async (req, res) => {
    const functionName = "checkDeviceStatus";
    const { deviceId } = req.query;
    
    // Allow pre-flight requests for CORS
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        res.status(204).send('');
        return;
    }

    if (!deviceId) {
      logger.warn({ message: "Bad Request: 'deviceId' query parameter is required.", functionName });
      return res.status(400).send("Bad Request: 'deviceId' query parameter is required.");
    }
    
    try {
      const deviceRef = db.collection("devices").doc(deviceId);
      const doc = await deviceRef.get();

      if (!doc.exists) {
        logger.warn({ message: "Device not found for polling.", functionName, deviceId });
        return res.status(404).send("Device not found.");
      }
      
      await deviceRef.update({ 'state.lastSeen': FieldValue.serverTimestamp() });

      const deviceData = doc.data();
      const isApproved = deviceData.approvedForProvisioning === true;

      if (isApproved) {
        const getScriptUrl = "https://getprovisionscript-e2ch5jbh6q-ew.a.run.app"; // This needs to be deployed
        const url = new URL(getScriptUrl);
        url.searchParams.append('device_hash', deviceData.hash);
        
        logger.info({ message: `Device is approved. Returning script URL.`, functionName, deviceId });
        return res.status(200).json({
          status: "approved",
          scriptUrl: url.toString(),
        });

      } else {
        logger.info({ message: `Device is awaiting approval. Current status: ${deviceData.provisioningStatus}`, functionName, deviceId });
        return res.status(200).json({
          status: deviceData.provisioningStatus || "awaiting_approval",
        });
      }
    } catch (error) {
      logger.error({ message: "Internal server error during status check.", functionName, deviceId, error: error.message, stack: error.stack });
      return res.status(500).send("Internal Server Error");
    }
  }
);

module.exports = {
  registerDevice,
  checkDeviceStatus,
};