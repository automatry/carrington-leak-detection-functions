/* eslint-disable valid-jsdoc */
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
require("dotenv").config();

/**
 * Recipients for email notifications.
 * @const {string[]}
 */
const EMAIL_RECIPIENTS = ["andrea@automatry.com", "support@automatry.com"];

/**
 * Sends an email notification.
 *
 * @param {string[]} recipients - Email addresses.
 * @param {string} subject - Email subject.
 * @param {string} message - Email body.
 * @return {Promise<void>}
 */
async function sendEmailNotification(recipients, subject, message) {
  logger.info("Sending email to: %s", recipients);
  logger.info("Subject: %s", subject);
  logger.info("Message:\n%s", message);

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: recipients.join(","),
    subject: subject,
    text: message,
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Sends an SMS notification (placeholder).
 *
 * @param {string} message - The SMS message.
 * @return {Promise<void>}
 */
async function sendSMSNotification(message) {
  logger.info("Sending SMS: %s", message);
  // TODO: Integrate with an SMS API (e.g., Twilio) as needed.
}

/**
 * Cloud Function triggered on any write to the "apartments"
 * collection. It processes update events only (where both before and
 * after snapshots exist) and triggers when the "status" or
 * "service_status" fields change.
 *
 * @return {Promise<void>}
 */
exports.notifyStatusChange = onDocumentUpdated(
  {
    document: "apartments/{apartmentId}",
    region: "europe-west1",
  },
  async (event) => {
    try {
      if (!event.data || !event.data.before || !event.data.after) {
        logger.error("Incomplete event data: %s", event.data);
        return;
      }
      // Only process update events.
      if (!event.data.before.exists || !event.data.after.exists) {
        logger.info("Skipping create or delete event.");
        return;
      }

      const beforeData = event.data.before.data();
      const afterData = event.data.after.data();

      if (
        beforeData.status === afterData.status &&
        beforeData.service_status === afterData.service_status
      ) {
        logger.info("No change in status; skipping.");
        return;
      }

      const subject = `Status Alert for Apartment ${afterData.APARTMENT}`;
      let msg = `Apartment: ${afterData.APARTMENT}\n`;
      msg += `Apartment ID: ${afterData.APARTMENT_ID}\n`;
      msg += `Leak Status: ${afterData.status}\n`;
      msg += `Service Status: ${afterData.service_status}\n`;
      msg += "HEY BUDDY!!";

      /**
       * Formats a Firestore Timestamp to ISO string.
       * @param {*} ts
       * @return {string}
       */
      const formatTs = (ts) =>
        ts && ts.toDate ? ts.toDate().toISOString() : ts || "N/A";

      msg += `Last Update: ${formatTs(afterData.lastUpdate)}\n`;
      msg += `Initiated At: ${formatTs(afterData.initiatedAt)}\n`;
      msg += `Device IP: ${afterData.deviceIP || "N/A"}\n`;

      if (afterData.error) {
        msg += `Error: ${afterData.error}\n`;
      }

      await sendEmailNotification(EMAIL_RECIPIENTS, subject, msg);
      await sendSMSNotification(`SMS Alert: ${subject}`);

      logger.info("Notified status change for %s", afterData.APARTMENT);
    } catch (err) {
      logger.error("Error in notifyStatusChange: %s", err.toString());
    }
  },
);
