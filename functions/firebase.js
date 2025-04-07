// functions/firebase.js
const admin = require("firebase-admin");
require("dotenv").config();

if (!admin.apps.length) {
  admin.initializeApp();
}

const { getStorage } = require("firebase-admin/storage");
// Pass the default app explicitly.
const storage = getStorage().bucket();

const db = admin.firestore();
const { BigQuery } = require("@google-cloud/bigquery");
const bigquery = new BigQuery();

console.log(storage);

module.exports = { admin, db, storage, bigquery };
