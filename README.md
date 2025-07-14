# Carrington Leak Detection Cloud

This repository contains the cloud portion of the Automatry/Carrington leak detection platform. It is built around Firebase and includes a Next.js web application along with a collection of Cloud Functions that manage device registration, log ingestion and provisioning.

## Repository structure

- **client/** – Next.js application served through Firebase Hosting and a Cloud Function.
- **functions/** – Firebase Cloud Functions (Node.js) including the Next.js server.
- **scripts/** – Utility scripts such as the device registration helper.
- **firebase.json** – Firebase configuration for hosting, functions, emulators and rules.

## Prerequisites

- Node.js 20.x
- Firebase CLI (`npm install -g firebase-tools`)
- A Google Cloud/Firebase project configured for this codebase

## Installation

1. Install dependencies for all workspaces.

   ```bash
   npm install
   ```

   This installs packages for both `client` and `functions` via npm workspaces.

2. Configure environment variables and secrets used by the functions. Common values include `DEVICE_UPDATE_TOKEN`, `TAILSCALE_API_KEY`, `FIREB_API_KEY` and BigQuery settings. You can place them in `functions/.env` for local development or use `firebase functions:secrets:set` for deployed environments.

3. Login to Firebase and select your project:

   ```bash
   firebase login
   firebase use <project-id>
   ```

## Local development

Start the Functions emulator (which also runs the built Next.js server):

```bash
npm run dev
```

The client app can also be run separately during development:

```bash
cd client
npm run dev
```

## Deployment

The project uses a predeploy hook that builds the Next.js app before deploying functions. Deploy all components with:

```bash
npm run deploy:all
```

Use `deploy:functions` or `deploy:app` to deploy parts individually.

## Additional scripts

The `scripts/register-device.sh` helper automates device registration on a Linux host by polling the registration and approval endpoints. See the comments in that script for usage details.

## License

This project is provided without a specific license. Consult the repository owner for usage terms.
