# Functions

This directory contains the Firebase Cloud Functions that power device onboarding, log ingestion, notifications and the Next.js server. The functions are written in Node.js and target Node 20 when deployed.

## Available functions

- **registerDevice** – initial device registration endpoint
- **checkDeviceStatus** – polling endpoint for devices waiting for approval
- **getProvisionScript** – generates a provisioning script for approved devices
- **updateDeviceStatus** – allows a device to update its state in Firestore
- **ingestLogs** – writes device log entries into BigQuery
- **notifyStatusChange** – Firestore trigger that emails notifications using SendGrid
- **processLogFile** – storage trigger that processes uploaded log files
- **nextServer** – serves the built Next.js app via HTTPS

See `index.js` for the mapping between these exports and their triggers.

## Environment variables

Functions load configuration from environment variables. For local development create a `.env` file in this folder. Important variables include:

- `DEVICE_UPDATE_TOKEN` – shared secret for device updates
- `TAILSCALE_API_KEY` – API key used when generating Tailscale keys
- `FIREB_API_KEY` – Firebase API key passed to provisioned devices
- `BQ_DATASET_ID` and `BQ_TABLE_ID` – BigQuery dataset and table for logs

Additional values are referenced across the source files. When deploying you may store them using `firebase functions:secrets:set`.

## Local development

Run the emulator from the project root:

```bash
npm run dev
```

This builds the Next.js application and starts the Functions emulator on port 5001.

## Deployment

Use the root scripts to deploy. The build step copies the Next.js output into this directory before deploying.

```bash
npm run deploy:functions
```

