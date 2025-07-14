const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const sgMail = require("@sendgrid/mail");
const logger = require("firebase-functions/logger");
const { db } = require("../firebaseClient");
const { renderNotificationHTML } = require("./emailTemplates");
const smsService = require("./services/smsService");

// Define all necessary secrets
const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const vonageApiKey = defineSecret("VONAGE_API_KEY");
const vonageApiSecret = defineSecret("VONAGE_API_SECRET");

// Firestore paths
const CONFIG_NOTIFICATIONS_DOC = "config/notifications";
const CONFIG_EMAIL_DOC = "config/email";
const RECIPIENTS_COLLECTION = "recipients";

/**
 * A robust utility to ensure a value is an array.
 * @param {*} value The value to check.
 * @returns {Array} The value if it's an array, otherwise an empty array.
 */
const ensureArray = (value) => (Array.isArray(value) ? value : []);

exports.notifyStatusChange = onDocumentCreated(
  {
    document: "notifications/{notificationId}",
    region: "europe-west1",
    secrets: [sendgridApiKey, vonageApiKey, vonageApiSecret],
  },
  async (event) => {
    const functionName = "notifyStatusChange";
    const notificationId = event.params.notificationId;
    const notificationRef = db.doc(`notifications/${notificationId}`);
    
    const dispatchDetails = {
      status: "processing",
      startedAt: new Date(),
      email: { processed: 0, sent: 0, failed: 0, results: [] },
      sms: { processed: 0, sent: 0, failed: 0, results: [] },
    };

    try {
      logger.info(`[${notificationId}] Starting notification processing.`);
      const notification = event.data.data();

      const deviceId = notification.deviceId || notification.deviceUUID;

      if (!notification || !deviceId) {
        throw new Error("Notification document is empty or missing a valid device ID (checked for deviceId and deviceUUID).");
      }

      // --- 1. Fetch Configuration and Recipients ---
      const [configSnap, deviceRecipientsSnap, emailConfigSnap] = await Promise.all([
        db.doc(CONFIG_NOTIFICATIONS_DOC).get(),
        db.doc(`${RECIPIENTS_COLLECTION}/${deviceId}`).get(),
        db.doc(CONFIG_EMAIL_DOC).get(),
      ]);

      const globalConfig = configSnap.exists ? configSnap.data() : {};
      const deviceRecipients = deviceRecipientsSnap.exists ? deviceRecipientsSnap.data() : {};
      const emailConfig = emailConfigSnap.exists ? emailConfigSnap.data() : {};
      
      // --- 2. Determine which channels to send to ---
      const sendEmail = notification.channels?.email ?? (notification.sendEmail ?? true);
      const sendSms = notification.channels?.sms ?? (notification.sendSms ?? true);

      // --- 3. Initialize Services ---
      const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
      if (globalConfig.email_enabled && sendEmail) {
        sgMail.setApiKey(isEmulator ? process.env.SENDGRID_API_KEY : sendgridApiKey.value());
      }
      if (globalConfig.sms_enabled && sendSms) {
        smsService.initializeVonage(
          isEmulator ? process.env.VONAGE_API_KEY : vonageApiKey.value(),
          isEmulator ? process.env.VONAGE_API_SECRET : vonageApiSecret.value()
        );
      }
      
      // --- 4. Consolidate and Deduplicate Recipients (ULTRA-DEFENSIVE LOGIC) ---
      // Use the ensureArray utility to guarantee we always have arrays to spread.
      const globalEmails = ensureArray(globalConfig.global_recipients?.emails);
      const deviceEmails = ensureArray(deviceRecipients.emails);
      const allEmails = [...globalEmails, ...deviceEmails];

      const globalSms = ensureArray(globalConfig.global_recipients?.sms);
      const deviceSms = ensureArray(deviceRecipients.sms);
      const allSms = [...globalSms, ...deviceSms];
      // --- END ULTRA-DEFENSIVE LOGIC ---

      const uniqueEmailTargets = new Map();
      allEmails.forEach(r => {
        if (r && r.active && r.address) uniqueEmailTargets.set(r.address.toLowerCase(), r);
      });

      const uniqueSmsTargets = new Map();
      allSms.forEach(r => {
        if (r && r.active && r.number && r.country_code) {
          const fullNumber = `${r.country_code}${r.number}`;
          uniqueSmsTargets.set(fullNumber, { ...r, fullNumber });
        }
      });
      
      logger.info(`[${notificationId}] Found ${uniqueEmailTargets.size} unique email and ${uniqueSmsTargets.size} unique SMS recipients.`);
      
      // --- 5. Prepare and Send Notifications ---
      const sendPromises = [];

      // Email Promises
      if (globalConfig.email_enabled && sendEmail && uniqueEmailTargets.size > 0) {
        const fromEmail = emailConfig.from || "leak-detection@automatry.com";
        const fromName = emailConfig.name || "Leak Detection";
        
        const emailMsg = {
          from: { email: fromEmail, name: fromName },
          replyTo: { email: emailConfig.reply_to || "no-reply@automatry.com", name: fromName },
          subject: notification.subject || "Automatry System Alert",
          text: notification.message || "An alert has been triggered.",
          html: renderNotificationHTML(notification),
        };

        uniqueEmailTargets.forEach(recipient => {
            const personalMsg = { ...emailMsg, to: recipient.address };
            dispatchDetails.email.processed++;
            sendPromises.push(
                sgMail.send(personalMsg)
                    .then(response => ({ type: 'email', status: 'fulfilled', recipient: recipient.address, data: response[0] }))
                    .catch(error => ({ type: 'email', status: 'rejected', recipient: recipient.address, reason: error.toString() }))
            );
        });
      }

      // SMS Promises
      if (globalConfig.sms_enabled && sendSms && uniqueSmsTargets.size > 0) {
        const detectionTime = (notification.triggeredAt?.toDate ? notification.triggeredAt.toDate() : new Date()).toLocaleString('en-GB');
        const smsText = `Leak Alert: A '${notification.type}' event occurred for apartment ${notification.apartment} at ${detectionTime}. Message: ${notification.message}`;
        
        uniqueSmsTargets.forEach(recipient => {
            dispatchDetails.sms.processed++;
            sendPromises.push(
                smsService.sendSms(recipient.fullNumber, smsText, process.env.VONAGE_SENDER_NAME)
                    .then(response => ({ type: 'sms', status: response.success ? 'fulfilled' : 'rejected', recipient: recipient.fullNumber, data: response }))
            );
        });
      }
      
      if (sendPromises.length === 0) {
          logger.warn(`[${notificationId}] No active recipients or channels enabled. Ending process.`);
          dispatchDetails.status = "completed_no_recipients";
          return;
      }
      
      // --- 6. Await All Sends and Process Results ---
      const results = await Promise.all(sendPromises);

      results.forEach(result => {
        const { type, status, recipient, data, reason } = result;
        if (type === 'email') {
          if (status === 'fulfilled') {
            dispatchDetails.email.sent++;
            dispatchDetails.email.results.push({ recipient, status: 'success', message_id: data?.headers?.['x-message-id'] || 'N/A' });
          } else {
            dispatchDetails.email.failed++;
            dispatchDetails.email.results.push({ recipient, status: 'failed', error: reason });
          }
        } else if (type === 'sms') {
          if (status === 'fulfilled') {
            dispatchDetails.sms.sent++;
            dispatchDetails.sms.results.push({ recipient, status: 'success', message_id: data.data?.['message-id'], details: data.data });
          } else {
            dispatchDetails.sms.failed++;
            dispatchDetails.sms.results.push({ recipient, status: 'failed', error: data.error, details: data.data });
          }
        }
      });
      
      dispatchDetails.status = (dispatchDetails.email.failed > 0 || dispatchDetails.sms.failed > 0) ? "completed_with_errors" : "completed_successfully";
      logger.info(`[${notificationId}] Processing finished. Status: ${dispatchDetails.status}`);

    } catch (err) {
      logger.error(`[${notificationId}] FATAL error during notification processing:`, err);
      dispatchDetails.status = "failed";
      dispatchDetails.error = err.toString();
    } finally {
      dispatchDetails.completedAt = new Date();
      await notificationRef.set({ dispatchDetails }, { merge: true });
      logger.info(`[${notificationId}] Wrote final dispatch details to Firestore.`);
    }
  }
);