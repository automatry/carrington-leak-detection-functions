const admin = require("firebase-admin");
require("dotenv").config();

// Initialize only if no app has been initialized yet.
if (!admin.apps.length) {
  admin.initializeApp();
}

module.exports = admin;
