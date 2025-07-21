/* eslint-disable quotes */
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const sgMail = require("@sendgrid/mail");
const logger = require("firebase-functions/logger");
const { db } = require("../firebaseAdmin");
const { renderNotificationHTML, generateSmsText } = require("./notificationTemplates");
const smsService = require("./services/smsService");

// Define all necessary secrets
const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const vonageApiKey = defineSecret("VONAGE_API_KEY");
const vonageApiSecret = defineSecret("VONAGE_API_SECRET");

// Firestore paths
const CONFIG_NOTIFICATIONS_DOC = "config/notifications";
const CONFIG_EMAIL_DOC = "config/email";
const RECIPIENTS_COLLECTION = "recipients";

function ensureArray(data, source) {
  if (Array.isArray(data)) {
    return data;
  }
  if (data && typeof data === 'object') {
    logger.warn(`[Data Consistency] Recipient list from ${source} was an object, not an array. Converting to array.`);
    return Object.values(data);
  }
  return [];
}


exports.notifyStatusChange = onDocumentCreated(
  {
    document: "notifications/{notificationId}",
    region: "europe-west1", 
    secrets: [sendgridApiKey, vonageApiKey, vonageApiSecret],
  },
  async (event) => {
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

      const [configSnap, deviceRecipientsSnap, emailConfigSnap] = await Promise.all([
        db.doc(CONFIG_NOTIFICATIONS_DOC).get(),
        db.doc(`${RECIPIENTS_COLLECTION}/${deviceId}`).get(),
        db.doc(CONFIG_EMAIL_DOC).get(),
      ]);

      const globalConfig = configSnap.exists ? configSnap.data() : { email_enabled: false, sms_enabled: false };
      const deviceRecipients = deviceRecipientsSnap.exists ? deviceRecipientsSnap.data() : {};
      const emailConfig = emailConfigSnap.exists ? emailConfigSnap.data() : {};

      const allEmails = [
        ...ensureArray(globalConfig.global_recipients?.emails, 'global config'),
        ...ensureArray(deviceRecipients.emails, `device ${deviceId}`),
      ];
      const allSms = [
        ...ensureArray(globalConfig.global_recipients?.sms, 'global config'),
        ...ensureArray(deviceRecipients.sms, `device ${deviceId}`),
      ];

      const uniqueEmailTargets = new Map();
      allEmails.forEach(r => {
        if (r.active && r.address) uniqueEmailTargets.set(r.address.toLowerCase(), r);
      });

      const uniqueSmsTargets = new Map();
      allSms.forEach(r => {
        if (r.active && r.number && r.country_code) {
          const fullNumber = `${r.country_code}${r.number}`;
          uniqueSmsTargets.set(fullNumber, { ...r, fullNumber });
        }
      });
      
      logger.info(`[${notificationId}] Found ${uniqueEmailTargets.size} unique, active email and ${uniqueSmsTargets.size} unique, active SMS recipients from cloud config.`);
      
      const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
      const sendPromises = [];

      if (globalConfig.email_enabled && uniqueEmailTargets.size > 0) {
        sgMail.setApiKey(isEmulator ? process.env.SENDGRID_API_KEY : sendgridApiKey.value());
        
        const fromEmail = emailConfig.from || "leak-detection@automatry.com";
        const fromName = emailConfig.name || "Leak Detection";
        
        // --- FIX: Generate email content from the smart template function ---
        const emailContent = renderNotificationHTML(notification);

        const emailMsg = {
          from: { email: fromEmail, name: fromName },
          replyTo: { email: emailConfig.reply_to || "no-reply@automatry.com", name: fromName },
          subject: emailContent.subject, // Use the generated subject
          text: notification.message, // Text field is a fallback for clients that don't render HTML
          html: emailContent.html, // Use the generated HTML
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

      if (globalConfig.sms_enabled && uniqueSmsTargets.size > 0) {
        smsService.initializeVonage(
          isEmulator ? process.env.VONAGE_API_KEY : vonageApiKey.value(),
          isEmulator ? process.env.VONAGE_API_SECRET : vonageApiSecret.value()
        );
        
        const smsText = generateSmsText(notification);
        
        uniqueSmsTargets.forEach(recipient => {
            dispatchDetails.sms.processed++;
            sendPromises.push(
                smsService.sendSms(recipient.fullNumber, smsText, process.env.VONAGE_SENDER_NAME || "Automatry")
                    .then(response => ({ type: 'sms', status: response.success ? 'fulfilled' : 'rejected', recipient: recipient.fullNumber, data: response, reason: response.error }))
                    .catch(error => ({ type: 'sms', status: 'rejected', recipient: recipient.fullNumber, reason: error.toString() }))
            );
        });
      }
      
      if (sendPromises.length === 0) {
          logger.warn(`[${notificationId}] No active recipients or channels enabled. Ending process.`);
          dispatchDetails.status = "completed_no_recipients";
          dispatchDetails.completedAt = new Date();
          await notificationRef.set({ dispatchDetails }, { merge: true });
          return;
      }
      
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
            dispatchDetails.sms.results.push({ recipient, status: 'failed', error: reason, details: data.data });
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