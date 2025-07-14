const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const SCRIPTS_COLLECTION = "bootstrap_scripts";

/**
 * Generates an error message script to be sent to the device.
 * This provides clear feedback on the device itself if something goes wrong.
 * @param {string} tag - The requested script tag.
 * @param {string} errorMsg - The specific error message.
 * @returns {string} A shell script that prints an error.
 */
function createErrorScript(tag, errorMsg) {
  const timestamp = new Date().toISOString();
  return `#!/bin/bash
# BOOTSTRAP FAILED at ${timestamp}
# Could not retrieve bootstrap script from the cloud.
echo "===================================================================="
echo "ERROR: Failed to download registration script."
echo "Timestamp: ${timestamp}"
echo "Requested Tag: ${tag}"
echo "Reason: ${errorMsg}"
echo "Please check the tag and server status."
echo "===================================================================="
exit 1
`;
}

exports.getBootstrapScript = onRequest(
  // This function is public and requires no authentication.
  { region: "europe-west1", cors: true },
  async (req, res) => {
    const functionName = "getBootstrapScript";
    const tag = req.query.tag;

    // --- 1. Validate the Request ---
    if (!tag) {
      logger.warn("Request received without a 'tag'.", { functionName });
      res.status(400).send("Bad Request: A 'tag' query parameter is required. Example: ?tag=carrington-leak-detection");
      return;
    }
    logger.info(`Bootstrap script requested for tag: '${tag}'`, { functionName, ip: req.ip });

    try {
      // --- 2. Fetch the Script from Firestore ---
      const db = getFirestore();
      const scriptRef = db.collection(SCRIPTS_COLLECTION).doc(tag);
      const scriptDoc = await scriptRef.get();

      if (!scriptDoc.exists) {
        logger.error(`Bootstrap script with tag '${tag}' not found in Firestore.`, { functionName });
        const errorScript = createErrorScript(tag, "Script tag not found.");
        res.status(404).setHeader("Content-Type", "text/plain").send(errorScript);
        return;
      }
      
      const scriptData = scriptDoc.data();
      const scriptContent = scriptData.script_content;
      
      if (!scriptContent || typeof scriptContent !== "string" || scriptContent.trim() === "") {
        logger.error(`Firestore document for tag '${tag}' is missing 'script_content'.`, { functionName });
        const errorScript = createErrorScript(tag, "Script content is empty or missing in the cloud database.");
        res.status(500).setHeader("Content-Type", "text/plain").send(errorScript);
        return;
      }
      
      // --- 3. Serve the Script ---
      logger.info(`Successfully served bootstrap script version ${scriptData.version || 'N/A'} for tag '${tag}'.`, { functionName });
      
      res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="register-${tag}.sh"`);
      res.status(200).send(scriptContent);

    } catch (error) {
      logger.error("A fatal error occurred while trying to fetch the bootstrap script.", {
        functionName,
        tag,
        error: error.message,
        stack: error.stack,
      });
      const errorScript = createErrorScript(tag, "An internal server error occurred.");
      res.status(500).setHeader("Content-Type", "text/plain").send(errorScript);
    }
  }
);