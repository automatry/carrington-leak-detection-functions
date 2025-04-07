const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { updateDeviceStatus } = require("./src/updateDeviceStatus");
const { ingestLogs } = require("./src/ingestLogs");
const { processLogFile } = require("./src/processLogFile");

exports.updateDeviceStatus = onRequest((req, res) => {
  logger.info("updateDeviceStatus function invoked");
  updateDeviceStatus(req, res);
});

exports.ingestLogs = onRequest((req, res) => {
  logger.info("ingestLogs function invoked");
  ingestLogs(req, res);
});

exports.processLogFile = processLogFile;

