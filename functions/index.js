const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { updateDeviceStatus } = require("./src/updateDeviceStatus");

exports.updateDeviceStatus = onRequest((req, res) => {
  logger.info("updateDeviceStatus function invoked");
  updateDeviceStatus(req, res);
});
