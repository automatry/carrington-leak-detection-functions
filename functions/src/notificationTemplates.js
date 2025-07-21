// functions/src/notificationTemplates.js
const logger = require("firebase-functions/logger");

/**
 * Generates the subject and HTML body for an email notification.
 * This function now creates its own content based on the notification type,
 * ignoring the raw 'subject' and 'message' fields from the database.
 * @param {object} notification The notification data from Firestore.
 * @returns {{subject: string, html: string}} An object containing the email subject and HTML body.
 */
function renderNotificationHTML(notification) {
  const apartmentName = notification.apartment || "unassigned apartment";
  let title, message, icon;

  // --- FIX: Generate clean title, message, and icon based on notification type ---
  switch (notification.type) {
    case "leak-detected":
      title = `Leak Detected in Apartment ${apartmentName}`;
      message = "A leak has been detected! Please investigate immediately.";
      icon = "🚨";
      break;
    case "leak-cleared":
      title = `Leak Cleared in Apartment ${apartmentName}`;
      message = "The leak previously reported has now been cleared.";
      icon = "✅";
      break;
    case "online":
      title = `Apartment ${apartmentName} Back Online`;
      message = "The apartment device has come back online and is now reachable.";
      icon = "🔄";
      break;
    case "offline":
      title = `Device Offline for Apartment ${apartmentName}`;
      message = "The device has lost its connection. The system will continue to monitor for its return.";
      icon = "⚠️";
      break;
    default:
      // A safe fallback for any unexpected types
      title = `Alert for ${apartmentName}`;
      message = "An important event has occurred that requires your attention.";
      icon = "ℹ️";
      break;
  }

  let formattedTime = "Not available";
  try {
    if (notification.triggeredAt && typeof notification.triggeredAt.toDate === "function") {
      formattedTime = notification.triggeredAt.toDate().toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }
  } catch (error) {
    logger.error("Failed to format timestamp for email.", { error: error.message });
  }

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        .container { max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
        .header { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 20px; }
        .content { font-size: 14px; line-height: 1.6; }
        .footer { margin-top: 30px; font-size: 12px; color: #888; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          ${icon} ${title}
        </div>
        <div class="content">
          <p>${message}</p>
          <p><strong>Time Triggered:</strong> ${formattedTime} (London Time)</p>
        </div>
        <div class="footer">
          <p>This email was generated automatically by the Automotry system. Please do not reply directly to this message.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return { subject: title, html: html };
}

/**
 * Generates a clean, human-readable SMS text message based on the notification type.
 * @param {object} notification The notification data from Firestore.
 * @returns {string} The formatted SMS text.
 */
function generateSmsText(notification) {
  const apartmentName = notification.apartment || "unassigned apartment";
  
  switch (notification.type) {
    case "leak-detected":
      return `Leak Alert: A leak has been detected in apartment '${apartmentName}'. Please investigate immediately.`;
    
    case "leak-cleared":
      return `Update: The leak alert for apartment '${apartmentName}' has now been cleared.`;

    case "offline":
      return `Connectivity Alert: The device for apartment '${apartmentName}' has gone offline.`;
      
    case "online":
      return `Update: The device for apartment '${apartmentName}' is back online and operational.`;

    default:
      logger.warn(`Generating SMS for unknown notification type: ${notification.type}`);
      return `Alert for ${apartmentName}: ${notification.subject || "An event has occurred."}`;
  }
}

module.exports = {
  renderNotificationHTML,
  generateSmsText,
};