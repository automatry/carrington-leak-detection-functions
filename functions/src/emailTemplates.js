// functions/emailTemplates.js

/**
 * Render an HTML notification email body.
 * @param {Object} notification - Notification data from Firestore
 * @return {string} HTML email content
 */
function renderNotificationHTML(notification) {
  const type = (notification.type || "generic").toLowerCase();
  
  // Handle Firestore Timestamp or other date formats
  let triggeredAt;
  try {
    if (notification.triggeredAt?.toDate) {
      // Firestore Timestamp object
      triggeredAt = notification.triggeredAt.toDate().toLocaleString();
    } else if (notification.triggeredAt instanceof Date) {
      // JavaScript Date object
      triggeredAt = notification.triggeredAt.toLocaleString();
    } else if (typeof notification.triggeredAt === "string") {
      // ISO string
      triggeredAt = new Date(notification.triggeredAt).toLocaleString();
    } else {
      triggeredAt = new Date().toLocaleString(); // fallback
    }
  } catch (err) {
    triggeredAt = "Unknown";
  }

  const apartment = notification.apartment || "Unknown";
  const status = notification.status || "N/A";
  const faultList = notification.faults || [];
  const faultsHTML = faultList.map((item) => `<li>${item}</li>`).join("");

  let title = "Automatry Notification";
  let message = "A system event has been triggered.";

  switch (type) {
    case "leak-detected":
      title = `🚨 Leak Detected in Apartment ${apartment}`;
      message = `A leak has been detected! Please investigate immediately.`;
      break;
    case "leak-cleared":
      title = `✅ Leak Cleared in Apartment ${apartment}`;
      message = `The leak previously reported has now been cleared.`;
      break;
    case "offline":
      title = `🔌 Apartment ${apartment} Went Offline`;
      message = `The apartment device is currently not responding.`;
      break;
    case "online":
      title = `🔄 Apartment ${apartment} Back Online`;
      message = `The apartment device has come back online and is now reachable.`;
      break;
    case "scheduled-report":
      title = `📋 Daily Fault Report`;
      message = `Below is a list of apartments with unresolved faults:`;
      break;
    default:
      title = notification.subject || "General Notification";
      message = notification.message || "Please review the system alert.";
      break;
  }

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f7f9fc;
            color: #333;
            padding: 2rem;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            padding: 2rem;
          }
          .header {
            border-bottom: 2px solid #e2e8f0;
            margin-bottom: 1.5rem;
          }
          .footer {
            font-size: 0.9rem;
            color: #888;
            margin-top: 2rem;
            border-top: 1px solid #e2e8f0;
            padding-top: 1rem;
          }
          h2 {
            color: #1a202c;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>${title}</h2>
          </div>
          <p>${message}</p>
          <p><strong>Time Triggered:</strong> ${triggeredAt}</p>
          ${
            type === "scheduled-report" && faultList.length > 0
              ? `<ul>${faultsHTML}</ul>`
              : ""
          }
          <div class="footer">
            This email was generated automatically 
            by the Automatry system.<br />
            Please do not reply directly to this message.
          </div>
        </div>
      </body>
    </html>
  `;
}

module.exports = { renderNotificationHTML };
