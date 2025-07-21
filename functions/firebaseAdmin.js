// functions/firebaseAdmin.js
const admin = require("firebase-admin");
const fs = require("fs");
const logger = require("firebase-functions/logger");

let credential;

// --- Hybrid Credential Loading ---

// Check if we are in ANY Firebase Emulator environment
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

if (isEmulator) {
  logger.info(
    "EMULATOR DETECTED. Forcing local service account key for initialization."
  );
  // This is the hardcoded path for local development ONLY.
  const localServiceAccountPath =
    "C:/Code/carrington-leak-detection-cloud/functions/keys/carrington-leak-detection-firebase-adminsdk-fbsvc-106694876f.json";

  if (fs.existsSync(localServiceAccountPath)) {
    try {
      credential = admin.credential.cert(localServiceAccountPath);
      logger.info(
        `Successfully initialized credentials for emulator from: ${localServiceAccountPath}`
      );
    } catch (e) {
      logger.error(
        `FATAL: Could not load the local service account file at ${localServiceAccountPath}. Please check the path.`,
        { errorMessage: e.message }
      );
      process.exit(1);
    }
  } else {
    logger.error(
      `FATAL: Local service account file not found at ${localServiceAccountPath}. This file is required to run the emulator.`
    );
    process.exit(1);
  }
} else {
  // This block runs ONLY when deployed to the cloud.
  logger.info(
    "NOT in an emulator. Using Application Default Credentials for deployed environment."
  );
  credential = admin.credential.applicationDefault();
}

const projectId = process.env.GCLOUD_PROJECT || "carrington-leak-detection";
const databaseURL = process.env.FIREBASE_DATABASE_EMULATOR_HOST
  ? undefined
  : `https://${projectId}.europe-west1.firebasedatabase.app`;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: credential,
    projectId: projectId,
    storageBucket: `${projectId}.appspot.com`,
    databaseURL: databaseURL,
  });
  logger.info(`Firebase Admin SDK initialized for project: ${projectId}`);
} else {
  logger.info("Firebase Admin SDK already initialized.");
}

// --- Service Initializations ---
const { getStorage } = require("firebase-admin/storage");
const { getFirestore } = require("firebase-admin/firestore");
const { getDatabase } = require("firebase-admin/database");
const { BigQuery } = require("@google-cloud/bigquery");

const db = getFirestore();
const rtdb = getDatabase();
const storage = getStorage().bucket();
const bigquery = new BigQuery();

// --- Emulator Detection Logging ---
if (process.env.FIRESTORE_EMULATOR_HOST) {
  logger.info(
    `***** FIRESTORE_EMULATOR_HOST detected: ${process.env.FIRESTORE_EMULATOR_HOST}. Using Firestore Emulator. *****`
  );
} else {
  logger.info("FIRESTORE_EMULATOR_HOST not set. Targeting LIVE Firestore.");
}

if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  logger.info(
    `***** RTDB_EMULATOR_HOST detected: ${process.env.FIREBASE_DATABASE_EMULATOR_HOST}. Using RTDB Emulator. *****`
  );
} else {
  logger.info("FIREBASE_DATABASE_EMULATOR_HOST not set. Targeting LIVE RTDB.");
}

module.exports = { admin, db, rtdb, storage, bigquery };
