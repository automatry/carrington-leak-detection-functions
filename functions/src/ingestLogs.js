const functions = require("firebase-functions");
const { BigQuery } = require("@google-cloud/bigquery");
require("dotenv").config();

const FORCE_NO_TOKEN_CHECK = process.env.FORCE_NO_TOKEN_CHECK === "true";
const ACCESS_TOKEN = process.env.DEVICE_UPDATE_TOKEN ||
                     process.env.FUNCTIONS_CONFIG_DEVICE_UPDATETOKEN;

const DATASET_ID = process.env.BQ_DATASET_ID || "leak_detection";
const TABLE_ID = process.env.BQ_TABLE_ID || "device_logs";
const bigquery = new BigQuery();

exports.ingestLogs = functions.https.onRequest(async (req, res) => {
  try {
    // Only allow POST requests.
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // Validate access token unless bypassed.
    if (!FORCE_NO_TOKEN_CHECK) {
      const token = req.body.token || req.headers.authorization;
      if (!token || token !== ACCESS_TOKEN) {
        return res.status(403).send("Forbidden: Invalid access token.");
      }
    } else {
      console.log("Token check bypassed (local testing mode).");
    }

    const logs = req.body.logs;
    if (!logs || !Array.isArray(logs)) {
      return res.status(400).send("Bad Request: 'logs' must be an array.");
    }

    const rows = logs.map((log) => ({
      timestamp: log.timestamp ? new Date(log.timestamp).toISOString() :
        new Date().toISOString(),
      apartment: log.apartment || "",
      apartment_id: log.apartment_id || "",
      device_ip: log.device_ip || "",
      bacnet_device_id: log.bacnet_device_id || "",
      bacnet_object: log.bacnet_object || "",
      event_type: log.event_type || "",
      value: log.value != null ? log.value.toString() : "",
      extra: log.extra ? JSON.stringify(log.extra) : "",
    }));

    console.log(`Inserting ${rows.length} rows into 
        BigQuery table ${DATASET_ID}.${TABLE_ID}...`);
    await bigquery.dataset(DATASET_ID).table(TABLE_ID).insert(rows);
    console.log("Rows successfully inserted.");

    return res.status(200).json({
      message: "Logs ingested successfully.",
      inserted: rows.length,
    });
  } catch (error) {
    console.error("Error ingesting logs:", error);
    return res.status(500).json({ error: error.toString() });
  }
});
