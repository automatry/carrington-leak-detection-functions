const admin = require("../../firebase"); // Import the central admin instance
const { FieldValue } = require("firebase-admin/firestore");

const FORCE_NO_TOKEN_CHECK = process.env.FORCE_NO_TOKEN_CHECK === "true";
const ACCESS_TOKEN = process.env.DEVICE_UPDATE_TOKEN ||
                     process.env.FUNCTIONS_CONFIG_DEVICE_UPDATETOKEN;

exports.updateDeviceStatus = async (req, res) => {
  try {
    // Only allow POST requests.
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // Token check (bypass if FORCE_NO_TOKEN_CHECK is true)
    if (!FORCE_NO_TOKEN_CHECK) {
      const token = req.body.token || req.headers.authorization;
      if (!token || token !== ACCESS_TOKEN) {
        return res.status(403).send("Forbidden: Invalid access token.");
      }
    } else {
      console.log("Token check bypassed (local testing mode).");
    }

    const { apartment, status, config, ip } = req.body;
    if (!apartment || !status) {
      return res.status(400).send("Bad Request: Missing required parameters.");
    }

    const db = admin.firestore();
    const apartmentRef = db.collection("apartments").doc(apartment);

    // Update the main document.
    await apartmentRef.set(
      {
        status,
        lastUpdate: FieldValue.serverTimestamp(),
        ...(ip ? { deviceIP: ip } : {}),
      },
      { merge: true },
    );

    // If configuration provided, store it in a subcollection.
    if (config) {
      const configRef = apartmentRef.collection("deviceConfig").doc("current");
      await configRef.set(
        {
          ...config,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return res.status(200).json({
      message: "Device status updated successfully.",
    });
  } catch (error) {
    console.error("Error updating device status:", error);
    return res.status(500).json({ error: error.toString() });
  }
};
