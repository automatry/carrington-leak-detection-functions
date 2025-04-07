const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../firebase");
require("dotenv").config();

const FORCE_NO_TOKEN_CHECK = process.env.FORCE_NO_TOKEN_CHECK === "true";
const ACCESS_TOKEN = process.env.DEVICE_UPDATE_TOKEN ||
 process.env.FUNCTIONS_CONFIG_DEVICE_UPDATETOKEN;

exports.updateDeviceStatus = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }
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

    const apartmentRef = db.collection("apartments").doc(apartment);

    await apartmentRef.set(
      {
        status,
        lastUpdate: FieldValue.serverTimestamp(),
        ...(ip ? { deviceIP: ip } : {}),
      },
      { merge: true },
    );

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
