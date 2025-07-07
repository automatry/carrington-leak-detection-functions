const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { storage, bigquery } = require("../firebaseClient");
const logger = require("firebase-functions/logger");
require("dotenv").config();

const DATASET_ID = process.env.BQ_DATASET_ID || "leak_detection";
const TABLE_ID = process.env.BQ_TABLE_ID || "device_logs";

exports.processLogFile = onObjectFinalized({
  region: "europe-west1", cpu: 2 }
, async (event) => {
  const fileBucket = event.data.bucket; // Bucket name as passed by the event
  const filePath = event.data.name;
  const contentType = event.data.contentType;
  logger.info(`Processing file ${filePath} from 
    bucket ${fileBucket} with content type ${contentType}`);

  if (!filePath.endsWith(".json")) {
    logger.info(`File ${filePath} is not a JSON file; skipping.`);
    return null;
  }

  // Since we already initialized storage with
  // the default bucket, we can use it directly.
  // (Alternatively, if you need to override, use:
  // storage.bucket('your-bucket-name'))
  const file = storage.file(filePath);

  try {
    const [contents] = await file.download();
    const logs = JSON.parse(contents.toString());

    if (!Array.isArray(logs)) {
      logger.error("Expected logs to be an array.");
      return null;
    }

    // Map each log entry to a BigQuery row.
    const rows = logs.map((log) => ({
      timestamp: log.timestamp ?
        new Date(log.timestamp).toISOString() :
        new Date().toISOString(),
      apartment: log.apartment || "",
      device_ip: log.device_ip || "",
      bacnet_device_id: log.bacnet_device_id || "",
      bacnet_object: log.bacnet_object || "",
      event_type: log.event_type || "",
      value: log.value != null ? log.value.toString() : "",
      // Ensure the apartment_id is lowercase.
      apartment_id: log.apartment_id ? log.apartment_id.toLowerCase() : "",
      extra: log.extra ? JSON.stringify(log.extra) : "",
    }));

    logger.info(`Inserting ${rows.length} rows into 
        BigQuery table ${DATASET_ID}.${TABLE_ID}...`);
    await bigquery.dataset(DATASET_ID).table(TABLE_ID).insert(rows);
    logger.info("Rows successfully inserted into BigQuery.");

    // Optionally, delete the file after processing:
    // await file.delete();

    return null;
  } catch (error) {
    logger.error("Error processing log file:", error);
    throw new Error(error);
  }
});
