const { Vonage } = require("@vonage/server-sdk");
const logger = require("firebase-functions/logger");

let vonage;

/**
 * Initializes the Vonage client.
 * @param {string} apiKey - The Vonage API Key.
 * @param {string} apiSecret - The Vonage API Secret.
 */
function initializeVonage(apiKey, apiSecret) {
  if (!apiKey || !apiSecret) {
    const errorMessage = "Vonage API Key and Secret are required for initialization.";
    logger.error(errorMessage, { function: "initializeVonage" });
    throw new Error(errorMessage);
  }
  if (!vonage) {
    vonage = new Vonage({ apiKey, apiSecret });
    logger.info("Vonage client initialized successfully.");
  }
}

/**
 * Sends an SMS message to a specified recipient.
 * @param {string} to - The recipient's phone number in E.164 format.
 * @param {string} text - The content of the SMS message.
 * @param {string} from - The sender ID/name.
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>} An object indicating success or failure.
 */
async function sendSms(to, text, from) {
  if (!vonage) {
    const errorMessage = "Vonage client is not initialized. Call initializeVonage first.";
    logger.error(errorMessage, { function: "sendSms" });
    return { success: false, data: null, error: errorMessage };
  }

  const sender = from || process.env.VONAGE_SENDER_NAME || "Automatry";
  
  logger.info(`Attempting to send SMS from "${sender}" to ${to}`, { function: "sendSms" });

  try {
    const responseData = await vonage.sms.send({ to, from: sender, text });

    if (responseData.messages[0].status === "0") {
      const successMessage = `Message sent successfully to ${to}. Message ID: ${responseData.messages[0]["message-id"]}`;
      logger.info(successMessage, { function: "sendSms", recipient: to });
      return { success: true, data: responseData.messages[0], error: null };
    } else {
      const errorMessage = `Message failed with status: ${responseData.messages[0].status}. Error: ${responseData.messages[0]["error-text"]}`;
      logger.error(errorMessage, { function: "sendSms", recipient: to, response: responseData.messages[0] });
      return { success: false, data: responseData.messages[0], error: errorMessage };
    }
  } catch (error) {
    logger.error("An unexpected error occurred while sending the SMS.", {
      function: "sendSms",
      recipient: to,
      errorMessage: error.message,
      stack: error.stack,
      vonageErrorDetails: error.response ? error.response.data : "No additional details",
    });
    return { success: false, data: null, error: `An unexpected error occurred: ${error.message}` };
  }
}

module.exports = {
  initializeVonage,
  sendSms,
};