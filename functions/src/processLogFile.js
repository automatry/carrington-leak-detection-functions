const functions = require("firebase-functions");
const admin = require("../../firebase");
const { BigQuery } = require("@google-cloud/bigquery");

// BigQuery settings – use environment variables if needed.
const DATASET_ID = process.env.BQ_DATASET_ID || "leak_detection";
const TABLE_ID = process.env.BQ_TABLE_ID || "device_logs";
const bigquery = new BigQuery();

// This function triggers when a new object is finalized in Cloud Storage.
exports.processLogFile =
functions.storage.object().onFinalize(async (object) => {
  const bucketName = object.bucket;
  const filePath = object.name;
  const contentType = object.contentType;
  console.log(`Processing file ${filePath} from 
    bucket ${bucketName} with content type ${contentType}`);

  // Only process JSON files.
  if (!filePath.endsWith(".json")) {
    console.log(`File ${filePath} is not a JSON file; skipping.`);
    return null;
  }

  // Get a reference to the file from Cloud Storage.
  const bucket = admin.storage().bucket(bucketName);
  const file = bucket.file(filePath);

  try {
    // Download file contents as a string.
    const [contents] = await file.download();
    const logs = JSON.parse(contents.toString());

    // Verify that logs is an array.
    if (!Array.isArray(logs)) {
      console.error("Expected logs to be an array.");
      return null;
    }

    // Map each log entry to a row for BigQuery.
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
      // Ensure the apartment ID is lowercase if provided.
      apartment_id: log.apartment_id ? log.apartment_id.toLowerCase() : "",
      extra: log.extra ? JSON.stringify(log.extra) : "",
    }));

    console.log(`Inserting ${rows.length} rows into 
        BigQuery table ${DATASET_ID}.${TABLE_ID}...`);
    await bigquery.dataset(DATASET_ID).table(TABLE_ID).insert(rows);
    console.log("Rows successfully inserted into BigQuery.");

    // Optionally, you might want to delete the file after processing:
    // await file.delete();

    return null;
  } catch (error) {
    console.error("Error processing log file:", error);
    throw new Error(error);
  }
});
