// functions/testing/seed_firestore_emulator.js
const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// --- Configuration for the device to seed ---
const TEST_SERIAL = "TESTSERIAL123"; // Or any serial you want to test with
// --- End Configuration ---

// Generate the hash for the serial
const deviceHash = crypto
  .createHash("sha256")
  .update(TEST_SERIAL)
  .digest("hex");
console.log(`Using Serial: ${TEST_SERIAL}`);
console.log(`Generated Hash: ${deviceHash}`);

// Initialize Firebase Admin SDK to connect to the *emulator*
// We don't need service account credentials when talking to the emulator
try {
  initializeApp({
    projectId: "carrington-leak-detection", // Use your actual project ID or a dummy one for emulator
  });
  console.log(
    `Firebase Admin SDK initialized for project: ${
      process.env.GCLOUD_PROJECT || "carrington-leak-detection"
    }`
  );
} catch (error) {
  // Catch error if already initialized (e.g., running script multiple times)
  if (error.code !== "app/duplicate-app") {
    console.error("Firebase Admin SDK initialization failed:", error);
    process.exit(1);
  } else {
    console.log("Firebase Admin SDK already initialized.");
  }
}

const db = getFirestore();
console.log(
  `Connecting to Firestore Emulator at: ${process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080"}`
);

async function seedDevice() {
  const deviceRef = db.collection("devices").doc(); // Let Firestore generate the ID

  const deviceData = {
    serial: TEST_SERIAL,
    hash: deviceHash,
    friendlyName: `Test Device ${TEST_SERIAL}`,
    registered: false, // Default state
    provisioningStatus: "not_provisioned", // Default state
    createdAt: new Date(), // Use local date for emulator seed
    // Add other fields your UI/logic might expect
  };

  try {
    console.log(
      `Attempting to write to devices collection with ID: ${deviceRef.id}`
    );
    await deviceRef.set(deviceData);
    console.log(`✅ Successfully seeded device:`);
    console.log(`   Document ID: ${deviceRef.id}`);
    console.log(`   Serial: ${deviceData.serial}`);
    console.log(`   Hash: ${deviceData.hash}`);
    console.log(
      "\nFirestore data seeded. You can now use the generated hash for testing."
    );
  } catch (error) {
    console.error("❌ Error seeding Firestore:", error);
  }
}

seedDevice();
