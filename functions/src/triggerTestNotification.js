const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

exports.triggerTestNotification = onCall({ region: "europe-west1" }, async (request) => {
  const functionName = "triggerTestNotification";
  
  // 1. Authentication Check
  if (!request.auth) {
    logger.error("User is not authenticated.", { functionName });
    throw new HttpsError("unauthenticated", "You must be logged in to perform this action.");
  }

  // 2. Data Validation
  const { deviceId, sendEmail, sendSms } = request.data;
  if (!deviceId || typeof sendEmail !== "boolean" || typeof sendSms !== "boolean") {
    logger.error("Invalid request payload.", { functionName, payload: request.data });
    throw new HttpsError("invalid-argument", "The function must be called with deviceId, sendEmail, and sendSms.");
  }
  
  if (!sendEmail && !sendSms) {
    return { status: "skipped", message: "No notification channels were selected." };
  }

  const db = getFirestore();
  const deviceRef = db.doc(`devices/${deviceId}`);

  try {
    // 3. Fetch Device Data
    const deviceSnap = await deviceRef.get();
    if (!deviceSnap.exists) {
      logger.error(`Device with ID ${deviceId} not found.`, { functionName });
      throw new HttpsError("not-found", `Device with ID ${deviceId} does not exist.`);
    }
    const deviceData = deviceSnap.data();
    const apartmentName = deviceData.identity?.APARTMENT || deviceData.serial || deviceId;

    // 4. Construct Notification Payload
    const notificationPayload = {
      deviceId: deviceId,
      apartment: apartmentName,
      type: "manual-test",
      subject: `[MANUAL TEST] Notification for ${apartmentName}`,
      message: "This is a test notification triggered from the web application.",
      triggeredAt: FieldValue.serverTimestamp(),
      // This is the crucial part that the main notification function will read
      channels: {
        email: sendEmail,
        sms: sendSms,
      },
      status: "pending", // The main function will update this
    };

    // 5. Create the notification document, which will trigger notifyStatusChange
    const notificationRef = await db.collection("notifications").add(notificationPayload);
    
    logger.info(`Successfully created test notification ${notificationRef.id} for device ${deviceId}.`, { functionName, triggeredBy: request.auth.uid });

    return { status: "success", message: "Test notification triggered successfully.", notificationId: notificationRef.id };

  } catch (error) {
    logger.error("Error triggering test notification:", { functionName, deviceId, error: error.toString(), stack: error.stack });
    // Re-throw internal errors as sanitized HTTPS errors
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "An internal error occurred while triggering the notification.");
  }
});