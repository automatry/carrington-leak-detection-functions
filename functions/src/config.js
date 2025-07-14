// functions/src/config.js
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

// --- 1. Define all secrets using the official API ---
// This allows Firebase to manage them during deployment.
const tailscaleApiKey = defineSecret("TAILSCALE_API_KEY");
const deviceUpdateToken = defineSecret("DEVICE_UPDATE_TOKEN");
const dockerPullerKey = defineSecret("DOCKER_PULLER_KEY");

// --- 2. Create a single, unified configuration object ---
const config = {
    // These values will be populated from environment variables
    tailnet: process.env.TAILSCALE_TAILNET,
    tailscaleTag: process.env.TAILSCALE_PROVISION_TAG || "tag:provisioned",
    deviceDockerImage: process.env.DEVICE_DOCKER_IMAGE,
    updateStatusUrl: process.env.DEVICE_STATUS_UPDATE_URL,
    wsServerUrl: process.env.WS_SERVER_URL,
    logBucketName: process.env.LOG_BUCKET_NAME,
    tailscaleKeyExpirySeconds: 600,

    // This is a getter function to handle the emulator vs. deployed logic cleanly.
    getSecrets: () => {
        const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
        if (isEmulator) {
            // In the emulator, secrets are loaded into process.env from .env.local
            logger.debug("Loading secrets from emulator environment variables.");
            return {
                tailscaleApiKey: process.env.TAILSCALE_API_KEY,
                deviceUpdateToken: process.env.DEVICE_UPDATE_TOKEN,
                dockerPullerKey: process.env.DOCKER_PULLER_KEY,
            };
        } else {
            // In production, we access the value from the defined secret parameters.
            logger.debug("Loading secrets from deployed function parameters.");
            return {
                tailscaleApiKey: tailscaleApiKey.value(),
                deviceUpdateToken: deviceUpdateToken.value(),
                dockerPullerKey: dockerPullerKey.value(),
            };
        }
    },

    // A helper to validate that all necessary config is present.
    validate: (secrets) => {
        const requiredEnvVars = [
            'tailnet', 'deviceDockerImage', 'updateStatusUrl', 'wsServerUrl', 'logBucketName'
        ];
        const requiredSecrets = [
            'tailscaleApiKey', 'deviceUpdateToken', 'dockerPullerKey'
        ];

        for (const key of requiredEnvVars) {
            if (!config[key]) {
                throw new Error(`FATAL: Missing required environment variable '${key.toUpperCase()}'`);
            }
        }
        for (const key of requiredSecrets) {
            if (!secrets[key]) {
                throw new Error(`FATAL: Missing required secret value for '${key.toUpperCase()}'`);
            }
        }
        logger.info("Configuration and secrets validated successfully.");
    }
};

// --- 3. Export everything needed by other modules ---
module.exports = {
    config,
    // Also export the secret definitions for use in function options
    definedSecrets: [tailscaleApiKey, deviceUpdateToken, dockerPullerKey],
};