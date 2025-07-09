// functions/notifyFromNotification.js

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const sgMail = require("@sendgrid/mail");
const logger = require("firebase-functions/logger");
const { db } = require("../firebaseClient");
const { renderNotificationHTML } = require("./emailTemplates");

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");

const FROM_EMAIL_DOC = "config/email";
const RECIPIENTS_DOC = "recipients/recipients";

exports.notifyStatusChange = onDocumentCreated(
  {
    document: "notifications/{notificationId}",
    region: "europe-west1",
    secrets: [sendgridApiKey],
  },
  async (event) => {
    const docId = event.params.notificationId;
    const notificationRef = db.doc(`notifications/${docId}`);
    const updateData = {
      status: "processing",
      sentAt: new Date(),
    };

    try {
      const notification = event.data.data();
      if (!notification) {
        throw new Error("Notification document is empty.");
      }

      const isLocal = process.env.NODE_ENV === "development";
      const apiKey = isLocal
        ? process.env.SENDGRID_API_KEY
        : sendgridApiKey.value();
      sgMail.setApiKey(apiKey);

      const recipientsSnap = await db.doc(RECIPIENTS_DOC).get();
      if (!recipientsSnap.exists) {
        throw new Error("Recipients document not found in Firestore.");
      }

      const recipients = recipientsSnap.data();
      const emailList = Array.isArray(recipients.emails)
        ? recipients.emails
        : [];

      const to = emailList
        .filter((r) => !r.copy_type || r.copy_type.toLowerCase() === "none")
        .map((r) => r.email_address)
        .filter(Boolean);

      const cc = emailList
        .filter((r) => r.copy_type && r.copy_type.toLowerCase() === "cc")
        .map((r) => r.email_address)
        .filter(Boolean);

      const bcc = emailList
        .filter((r) => r.copy_type && r.copy_type.toLowerCase() === "bcc")
        .map((r) => r.email_address)
        .filter(Boolean);

      if (to.length === 0) {
        const fallbackEmail = recipients.fallback_to || "support@automatry.com";
        to.push(fallbackEmail);
      }

      const fromDoc = await db.doc(FROM_EMAIL_DOC).get();
      const emailConfig = fromDoc.exists ? fromDoc.data() : {};

      // Default to original email
      const fromEmail = emailConfig.from || "leak-detection@automatry.com";
      const fromName = emailConfig.name || "Leak Detection";
      const replyToEmail = emailConfig.reply_to || "no-reply@automatry.com";

      const from = {
        email: fromEmail,
        name: fromName,
      };

      const replyTo = {
        email: replyToEmail,
        name: fromName,
      };

      const subject = notification.subject || "🚨 Leak or Device Alert";
      const plainText =
        notification.message ||
        "An alert has been triggered. Please check the system.";
      const html = renderNotificationHTML(notification);

      // Deduplicate addresses
      const seen = new Set();
      const cleanTo = to.filter((email) => !seen.has(email) && seen.add(email));
      const cleanCc = cc.filter((email) => !seen.has(email) && seen.add(email));
      const cleanBcc = bcc.filter(
        (email) => !seen.has(email) && seen.add(email)
      );

      const msg = {
        to: cleanTo,
        cc: cleanCc.length ? cleanCc : undefined,
        bcc: cleanBcc.length ? cleanBcc : undefined,
        from,
        replyTo,
        subject,
        text: plainText,
        html,
      };

      logger.info("Sending email with payload:", JSON.stringify(msg, null, 2));
      await sgMail.send(msg);

      updateData.status = "sent";
    } catch (err) {
      logger.error("Notification error:", err);
      updateData.status = "error";
      updateData.error = err.toString();
    }

    await notificationRef.update(updateData);
  }
);
