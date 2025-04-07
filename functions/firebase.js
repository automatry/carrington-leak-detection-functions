// functions/firebase.js
const admin = require("firebase-admin");
require("dotenv").config();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "carrington-leak-detection",
    storageBucket: "carrington-leak-detectionappspot.com",
  });
}

const { getStorage } = require("firebase-admin/storage");
// Pass the default app explicitly.
const storage = getStorage().bucket();

const db = admin.firestore();
if (process.env.NODE_ENV === "development") {
  db.settings({
    host: "localhost:8080", // Default Firestore Emulator host and port
    ssl: false,
  });
}

const { BigQuery } = require("@google-cloud/bigquery");
const bigquery = new BigQuery();

// console.log(storage);

module.exports = { admin, db, storage, bigquery };
