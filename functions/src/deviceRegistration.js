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
 * registerDevice - Handles device registration and re-registration.
 * It sanitizes incoming serial numbers and resets existing devices for re-approval.
 */
const registerDevice = onRequest(
  { region: "europe-west1", cors: true },
  async (req, res) => {
    const functionName = "registerDevice";

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
      
      // --- CRITICAL FIX: SERVER-SIDE SANITIZATION ---
      // This removes all non-printable ASCII control characters (like \r, \n, etc.)
      // and trims whitespace from the beginning and end. This is the definitive fix.
      const sanitizedSerial = serial.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
      
      if (sanitizedSerial.length === 0) {
        logger.error({ message: "Bad Request: Serial number became empty after sanitization.", functionName, originalSerial: serial });
        return res.status(400).send("Bad Request: 'serial' contained only invalid characters.");
      }

      logger.info({ message: `Registration request for serial: '${sanitizedSerial}' (Original: '${serial}')`, functionName, ip: req.ip });

      const devicesRef = db.collection("devices");
      const q = devicesRef.where("serial", "==", sanitizedSerial).limit(1);
      const snapshot = await q.get();

      if (!snapshot.empty) {
        const existingDoc = snapshot.docs[0];
        logger.info({ message: `Existing device found (ID: ${existingDoc.id}). Resetting for re-provisioning.`, functionName, serial: sanitizedSerial });

        const updatePayload = {
          provisioningStatus: "awaiting_approval",
          approvedForProvisioning: false,
          lastSeen: FieldValue.serverTimestamp(),
          lastProvisionRequest: FieldValue.delete(),
        };

        await existingDoc.ref.update(updatePayload);
        
        logger.info({ message: `Device ${existingDoc.id} successfully reset to 'awaiting_approval'.`, functionName });
        return res.status(200).json({
          deviceId: existingDoc.id,
          status: "awaiting_approval",
        });
      }

      logger.info({ message: `New device. Creating record for serial: ${sanitizedSerial}`, functionName });
      const newDeviceHash = createHash(sanitizedSerial);
      const newDeviceData = {
        serial: sanitizedSerial,
        hash: newDeviceHash,
        friendlyName: `Device ${sanitizedSerial}`,
        registered: false,
        approvedForProvisioning: false,
        provisioningStatus: "awaiting_approval",
        identity: { commissioned: false, APARTMENT: `Awaiting Approval (${sanitizedSerial})`, PROJECT: "Unassigned" },
        state: { connectivity_status: "unknown", leak_status: "unknown" },
        config: { flags: { enable_bacnet: true, enable_leak_detection: true }},
        createdAt: FieldValue.serverTimestamp(),
        lastSeen: FieldValue.serverTimestamp(),
      };

      const docRef = await devicesRef.add(newDeviceData);
      logger.info({ message: `New device created successfully. ID: ${docRef.id}`, functionName, serial: sanitizedSerial });

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

// --- The checkDeviceStatus function remains the same as my previous answer ---
// (No changes are needed for it based on this error)
const checkDeviceStatus = onRequest(
    { region: "europe-west1", cors: true },
    async (req, res) => {
        const functionName = "checkDeviceStatus";
        
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

        const { deviceId } = req.body;
        if (!deviceId) {
          logger.warn({ message: "Bad Request: 'deviceId' is required in the POST body.", functionName });
          return res.status(400).send("Bad Request: 'deviceId' is required in the POST body.");
        }
        
        try {
          const deviceRef = db.collection("devices").doc(deviceId);
          const doc = await deviceRef.get();
    
          if (!doc.exists) {
            logger.warn({ message: "Device not found for polling.", functionName, deviceId });
            return res.status(404).send("Device not found.");
          }
          
          deviceRef.update({ 'state.lastSeen': FieldValue.serverTimestamp() }).catch(err => {
              logger.error({ message: "Failed to update lastSeen timestamp.", functionName, deviceId, error: err.message });
          });
    
          const deviceData = doc.data();
          const isApproved = deviceData.approvedForProvisioning === true;
    
          if (isApproved) {
            const getScriptUrl = `https://getprovisionscript-e2ch5jbh6q-ew.a.run.app?device_hash=${deviceData.hash}`;
            
            logger.info({ message: `Device is approved. Returning script URL.`, functionName, deviceId });
            return res.status(200).json({
              status: "approved",
              scriptUrl: getScriptUrl,
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