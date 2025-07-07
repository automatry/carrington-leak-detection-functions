// functions/src/next_server.js
const { onRequest } = require("firebase-functions/v2/https");
const next = require("next");
const path = require("path");

// This function will be referenced in firebase.json to serve the Next.js app.
// It points to the 'client' directory where your Next.js project lives.
const nextApp = next({
  dev: false, // This is CRITICAL for production
  conf: {
    // The distDir must match the .next folder that `npm run build` creates inside the client directory.
    // We resolve the path from the functions directory to the client directory.
    distDir: path.resolve(__dirname, "../../client/.next"),
  },
});

const handle = nextApp.getRequestHandler();

exports.nextServer = onRequest(
  {
    region: "europe-west1", // Match your other functions
    memory: "1GiB", // Recommended for Next.js SSR
    timeoutSeconds: 60, // Give it time to render
  },
  async (req, res) => {
    // This will prepare the Next.js app on the first request.
    await nextApp.prepare();
    return handle(req, res);
  }
);