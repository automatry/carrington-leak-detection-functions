# Client Web Application

This folder contains the Next.js based administrative interface for the leak detection platform.
The app communicates with the Firebase back‑end for authentication and device management.

## Development

Run the dev server with:

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000).
Authentication requires Firebase configuration in `src/lib/firebase.js`.

## Building for production

When deploying through Firebase the root `npm run deploy:*` scripts handle building and copying the generated `.next` directory into the `functions` folder. You can build locally with:

```bash
npm run build
```

and start a production preview with `npm start`.

## Folder structure

- `src/app/` – Next.js App Router pages and components
- `src/lib/` – shared helpers such as the Firebase client

This project uses React 19 and Next.js 15.
