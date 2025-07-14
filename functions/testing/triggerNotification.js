/* eslint-disable quotes */
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");

// IMPORTANT: This script uses the same hardcoded path as your firebaseClient.
// Ensure this path is correct for your machine.
const serviceAccountPath = "C:/Code/carrington-leak-detection-cloud/functions/keys/carrington-leak-detection-firebase-adminsdk-fbsvc-106694876f.json";

if (!fs.existsSync(serviceAccountPath)) {
    console.error("\nFATAL ERROR: Service account key not found at path:");
    console.error(serviceAccountPath);
    console.error("Please update the 'serviceAccountPath' variable in this script.\n");
    process.exit(1);
}

// Initialize the Admin SDK. It will automatically connect to the running
// Firestore emulator because the `FIRESTORE_EMULATOR_HOST` environment
// variable is set by the `firebase emulators:start` command.
try {
    initializeApp({
        credential: cert(serviceAccountPath),
        projectId: "carrington-leak-detection",
    });
} catch (e) {
    if (e.code !== 'app/duplicate-app') {
        console.error('Firebase Admin SDK initialization error', e);
        process.exit(1);
    }
}

const db = getFirestore();

async function createTestNotification() {
    console.log("Attempting to create a test notification document...");

    const notificationPayload = {
        // This deviceId MUST match the document ID you created in the 'recipients' collection.
        deviceId: "test-device-123", 
        apartment: "Test Apt 101",
        type: "leak-detected",
        subject: "🚨 LOCAL TEST: Leak Detected in Test Apt 101",
        message: "A leak has been detected during a local test run.",
        triggeredAt: new Date(),
        // You can add more fields from your device payload as needed
        details: {
            current_leak_status: "active",
            reason: "Test trigger from script"
        }
    };

    try {
        const docRef = await db.collection("notifications").add(notificationPayload);
        console.log(`✅ Successfully created notification document with ID: ${docRef.id}`);
        console.log("Check the terminal running 'firebase emulators:start' for function logs.");
    } catch (error) {
        console.error("❌ Failed to create notification document:", error);
    }
}

createTestNotification();