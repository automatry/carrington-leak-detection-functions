// functions/src/next_server.js
const { onRequest } = require("firebase-functions/v2/https");
const next = require("next");
const path = require("path");
const logger = require("firebase-functions/logger");
const fs = require('fs'); // Import fs for debugging

// The 'functions' directory is the logical "project root" for the Next.js server
// when it runs as a Cloud Function.
const serverProjectRoot = path.resolve(__dirname, "..");
const buildDir = path.join(serverProjectRoot, '.next');

// --- Pre-flight Check for Debugging ---
logger.info("nextServer: Initializing...", {
    serverProjectRoot,
    buildDir
});
try {
    const filesInWorkspace = fs.readdirSync('/workspace');
    logger.info("Files in /workspace:", { files: filesInWorkspace });

    if(fs.existsSync(buildDir)) {
        const filesInBuildDir = fs.readdirSync(buildDir);
        // Log the first 10 files/folders to avoid overly long log entries
        logger.info("Build directory found. Files inside .next:", { files: filesInBuildDir.slice(0, 10) });
    } else {
        logger.error("Build directory NOT FOUND at expected path.", { expectedPath: buildDir });
    }
} catch (e) {
    logger.error("Error during pre-flight directory check:", { error: e.message });
}
// --- End Pre-flight Check ---

const nextApp = next({
  dev: false,
  dir: serverProjectRoot, // Explicitly set the project directory for Next.js
  conf: {
    // The 'distDir' is relative to 'dir', so this points to './functions/.next'
    distDir: ".next",
  },
});

const handle = nextApp.getRequestHandler();

exports.nextServer = onRequest(
  {
    region: "europe-west1",
    memory: "1GiB",
    timeoutSeconds: 60,
  },
  async (req, res) => {
    try {
      // The prepare call will now correctly find the build output before handling requests.
      await nextApp.prepare();
      return handle(req, res);
    } catch (error) {
      logger.error("Next.js server failed to handle request", {
        errorMessage: error.message,
        stack: error.stack,
        url: req.originalUrl,
      });
      res.status(500).send("Internal Server Error: Could not start Next.js server.");
    }
  }
);