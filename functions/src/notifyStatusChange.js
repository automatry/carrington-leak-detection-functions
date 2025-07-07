// functions/notifyFromNotification.js
const { onDocumentCreated } =
  require("firebase-functions/v2/firestore");
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
      const apiKey = isLocal ? process.env.SENDGRID_API_KEY :
        sendgridApiKey.value();

      sgMail.setApiKey(apiKey);

      const recipientsSnap = await db.doc(RECIPIENTS_DOC).get();
      if (!recipientsSnap.exists) {
        throw new Error("Recipients document not found in Firestore.");
      }

      const recipients = recipientsSnap.data();
      const emailList = Array.isArray(recipients.emails) ?
        recipients.emails : [];

      const to = emailList
        .filter((r) => {
          return !r.copy_type || r.copy_type.toLowerCase() === "none";
        })
        .map((r) => {
          return r.email_address;
        });

      const cc = emailList
        .filter((r) => {
          return r.copy_type && r.copy_type.toLowerCase() === "cc";
        })
        .map((r) => {
          return r.email_address;
        });

      const bcc = emailList
        .filter((r) => {
          return r.copy_type && r.copy_type.toLowerCase() === "bcc";
        })
        .map((r) => {
          return r.email_address;
        });

      // fallback to configured fallback TO address, not BCCs
      if (to.length === 0) {
        const fallbackEmail = recipients.fallback_to ||
          "support@automatry.com";
        to.push(fallbackEmail);
      }

      const fromDoc = await db.doc(FROM_EMAIL_DOC).get();
      const emailConfig = fromDoc.exists ? fromDoc.data() : {};

      const from = emailConfig.from ?
        emailConfig.from : "leak-detection@automatry.com";
      const replyTo = emailConfig.reply_to ?
        emailConfig.reply_to : "no-reply@automatry.com";

      const subject = notification.subject ?
        notification.subject : "Leak or Status Alert";
      const plainText = notification.message ?
        notification.message : "Alert triggered.";
      const html = renderNotificationHTML(notification);

      // Deduplicate recipients across to, cc, and bcc
      const allEmails = new Set([...to, ...cc, ...bcc]);
      const cleanTo = to.filter((email) => email && allEmails.has(email));
      const cleanCc = cc.filter((email) => email && !cleanTo.includes(email));
      const cleanBcc = bcc.filter((email) => {
        return email && !cleanTo.includes(email) && !cleanCc.includes(email);
      });

      const msg = {
        to: cleanTo,
        cc: cleanCc,
        bcc: cleanBcc,
        from: from,
        replyTo: replyTo,
        subject: subject,
        text: plainText,
        html: html,
      };

      logger.info("Final email payload:", JSON.stringify(msg, null, 2));
      await sgMail.send(msg);

      updateData.status = "sent";
    } catch (err) {
      logger.error("Notification error:", err);
      updateData.status = "error";
      updateData.error = err.toString();
    }

    await notificationRef.update(updateData);
  },
);
