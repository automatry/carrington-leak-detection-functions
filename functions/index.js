const logger = require("firebase-functions/logger");
const { onRequest } = require("firebase-functions/v2/https");
// Assuming processLogFile might be a storage trigger:
// const { onObjectFinalized } = require("firebase-functions/v2/storage");

// --- Import Function Logic from ./src ---
// Group imports by trigger type or functionality for clarity
const { updateDeviceStatus } = require("./src/updateDeviceStatus"); // HTTP
const { ingestLogs } = require("./src/ingestLogs");                 // HTTP
const { getProvisionScript } = require("./src/getProvisionScript");     // HTTP
const { notifyStatusChange } = require("./src/notifyStatusChange");     // Firestore Trigger
const { processLogFile } = require("./src/processLogFile");         // Assumed Background Trigger (e.g., Storage)

logger.info("Importing function modules completed.");

// --- Define Common Options (Optional) ---
const defaultHttpOptions = {
  region: "europe-west1",
  // Add common secrets or settings here if many functions share them
  // secrets: ["SOME_SHARED_SECRET"],
};

// --- HTTP Function Exports ---
// These use onRequest and are triggered by HTTP requests.
exports.updateDeviceStatus = onRequest(defaultHttpOptions, (req, res) => {
  // Basic logging, more detailed logging should be within the function itself
  logger.info(`HTTP Request: updateDeviceStatus - ${req.method} ${req.path}`, { ip: req.ip });
  updateDeviceStatus(req, res); // Pass req, res
});

exports.ingestLogs = onRequest(defaultHttpOptions, (req, res) => {
  logger.info(`HTTP Request: ingestLogs - ${req.method} ${req.path}`, { ip: req.ip });
  ingestLogs(req, res);
});

// Use specific options for getProvisionScript
exports.getProvisionScript = onRequest({
  ...defaultHttpOptions, // Inherit region
  secrets: ["TAILSCALE_API_KEY", "FIREB_API_KEY"], // Specific secrets
}, (req, res) => {
  // Logging handled within the function
  getProvisionScript(req, res);
});


// --- Background Function Exports ---
// These functions are triggered by backend events (Firestore, Storage, Pub/Sub, etc.)
// Their triggers should be defined *within their respective files* (like notifyStatusChange does).
// We just export the handler function directly by name here.

// Exporting the handler directly. The trigger (onDocumentCreated) is defined
// *inside* './src/notifyStatusChange.js'.
exports.notifyStatusChange = notifyStatusChange;

// Exporting the handler directly. Assuming the trigger (e.g., onObjectFinalized)
// is defined *inside* './src/processLogFile.js'.
// If not, you need to define the trigger here or in its file.
// Example IF trigger was defined here:
// exports.processLogFile = onObjectFinalized({ ...defaultHttpOptions, bucket: 'your-bucket'}, processLogFile);
exports.processLogFile = processLogFile; // Assuming trigger is defined inside its file

// --- Final Log ---
logger.info("All function handlers loaded and exported.", {
  exportedFunctions: Object.keys(exports).join(', '),
});