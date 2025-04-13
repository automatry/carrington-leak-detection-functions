// functions/firebase.js
const admin = require("firebase-admin");
const fs = require("fs"); // Import filesystem module to check file existence

// --- FORCE PATH FOR TESTING ---
// Hardcode the correct path with forward slashes for testing
const explicitServiceAccountPath = "C:/.gcp/service-accounts/carrington-leak-detection-69c3bfacbc1e.json"; // Use your actual path
console.log("Attempting to force service account path:", explicitServiceAccountPath);
// --- END FORCE PATH ---

// Use the explicitly defined path instead of process.env
const serviceAccountPath = explicitServiceAccountPath;
console.log("Using service account path:", serviceAccountPath);

let credential;

// --- EXPLICIT CREDENTIAL LOADING ---
if (serviceAccountPath) {
  console.log(
    `GOOGLE_APPLICATION_CREDENTIALS is set to: ${serviceAccountPath}`
  );
  // Check if the file actually exists before trying to load it
  if (fs.existsSync(serviceAccountPath)) {
    try {
      // Attempt to load the credential directly from the specified path
      credential = admin.credential.cert(serviceAccountPath);
      console.log(
        "Successfully created credential object from service account file."
      );
    } catch (certError) {
      console.error(
        `!!! Error loading service account from ${serviceAccountPath}:`,
        certError
      );
      console.warn("Falling back to Application Default Credentials search.");
      credential = admin.credential.applicationDefault(); // Fallback on error
    }
  } else {
    console.error(
      `!!! Service account file specified by GOOGLE_APPLICATION_CREDENTIALS not found at: ${serviceAccountPath}`
    );
    console.warn("Falling back to Application Default Credentials search.");
    credential = admin.credential.applicationDefault(); // Fallback if file not found
  }
} else {
  // If the environment variable wasn't set, use the standard ADC search
  console.log(
    "GOOGLE_APPLICATION_CREDENTIALS not set. Using Application Default Credentials search."
  );
  credential = admin.credential.applicationDefault();
}
// --- END EXPLICIT CREDENTIAL LOADING ---

const projectId = process.env.GCLOUD_PROJECT || "carrington-leak-detection";
const databaseURL = process.env.FIREBASE_DATABASE_EMULATOR_HOST
  ? undefined
  : `https://${projectId}.europe-west1.firebasedatabase.app`;

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      // --- Use the explicitly determined credential ---
      credential: credential,
      // --- End credential usage ---
      projectId: projectId,
      storageBucket: `${projectId}.appspot.com`,
      databaseURL: databaseURL,
    });
    console.log(`Firebase Admin SDK initialized for project: ${projectId}`);
    if (databaseURL) {
      console.log(`Database URL configured: ${databaseURL}`);
    } else {
      console.log(
        `Database URL not explicitly set; SDK may target RTDB emulator via env var.`
      );
    }
    // Log credential type *after* initializeApp if possible (or check credential object before)
    // console.log("Admin SDK initialized with credential type:", admin.app().options.credential?.constructor?.name || 'Unknown');
  } catch (error) {
    console.error("!!! Firebase Admin SDK initialization failed:", error);
  }
} else {
  console.log("Firebase Admin SDK already initialized.");
}

// --- Imports and Service Initializations (Remain the same) ---
const { getStorage } = require("firebase-admin/storage");
const { getFirestore } = require("firebase-admin/firestore");
const { getDatabase } = require("firebase-admin/database");
const { BigQuery } = require("@google-cloud/bigquery");

const db = getFirestore();
const rtdb = getDatabase();
const storage = getStorage().bucket();
const bigquery = new BigQuery();

// --- STRICT EMULATOR DETECTION (Remains the same) ---
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  console.log(
    `***** FIRESTORE_EMULATOR_HOST detected: ${host}. Applying Firestore Emulator settings. *****`
  );
  try {
    db.settings({ host: host, ssl: false });
    console.log(`Firestore SDK configured to use emulator at ${host}`);
  } catch (emulatorError) {
    console.warn(
      "Could not apply Firestore Emulator settings:",
      emulatorError.message
    );
  }
} else {
  console.log("FIRESTORE_EMULATOR_HOST not set. Targeting LIVE Firestore.");
}

if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  console.log(
    `RTDB Emulator target detected: ${process.env.FIREBASE_DATABASE_EMULATOR_HOST}. SDK will target emulator.`
  );
} else {
  console.log("FIREBASE_DATABASE_EMULATOR_HOST not set. Targeting LIVE RTDB.");
}
// --- END STRICT EMULATOR DETECTION ---

module.exports = { admin, db, rtdb, storage, bigquery };
