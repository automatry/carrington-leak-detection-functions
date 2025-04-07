const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { updateDeviceStatus } = require("./src/updateDeviceStatus");
const { ingestLogs } = require("./src/ingestLogs");
const { processLogFile } = require("./src/processLogFile");

// Deploy all HTTP functions to europe-west1.
exports.updateDeviceStatus = onRequest({
  region: "europe-west1",
}, (req, res) => {
  logger.info("updateDeviceStatus function invoked");
  updateDeviceStatus(req, res);
});

exports.ingestLogs = onRequest({
  region: "europe-west1",
}, (req, res) => {
  logger.info("ingestLogs function invoked");
  ingestLogs(req, res);
});

// For the storage trigger, ensure the trigger is set to europe-west1 as well.
exports.processLogFile = processLogFile;
// processLogFile itself should be set with { region: "europe-west1", ... }
logger.info("Functions loaded: updateDeviceStatus, ingestLogs, processLogFile");
