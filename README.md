# Parcel Desk � Meesho Operations

Responsive operations dashboard for managing Meesho client panels, shipments, returns, balances, and ledger activity in one place.

## Overview

This project is a Vite + React + TypeScript app built for parcel operations teams. It supports:

- admin, staff, and client role-aware access
- label upload and OCR review
- shipment management and tracking
- return evidence and approval flow
- balance and ledger tracking
- client account login setup
- Supabase-backed auth and data storage

## Run locally

1. Install Node.js 20+.
2. Open the project folder in a terminal.
3. Install dependencies and run the app:

   ```sh
   npm install
   npm run dev
   ```

4. Open the local URL shown in the terminal, typically `http://localhost:5173/` or the next available Vite port.

## Environment variables

Create a `.env.local` file with the Supabase values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The app uses Supabase Auth and Supabase tables as the active backend. This deployment is configured as a fresh start: old Firebase records are not imported, and clients/orders should be created again in the panel.

Client login creation and password resets use the `supabase/functions/admin-client-login` Edge Function. Deploy it with `supabase functions deploy admin-client-login`; its service-role key must remain a server-side secret. The function confirms managed client accounts automatically, so clients can sign in without waiting for an email confirmation. Client deletion is a soft delete (`active=false`) so its orders and ledger history remain available.

## Default admin login

For local fallback testing, the app recognizes:

- email: `admin@gmail.com`
- password: `admin123`

This is meant for quick access and local testing, not as the production auth path.

## Build verification

The project was verified with a production build:

```sh
npm run build
```

This succeeds with the current Vite configuration and generates the `dist/` output.

## Vercel deployment notes

If deploying to Vercel, use:

- Framework preset: `Vite`
- Root directory: `.`
- Build command: `npm run build`
- Output directory: `dist`

This repository is already connected to GitHub and the project files are included in the current branch.

## Notes

- The app is currently configured around Supabase rather than Firebase for production auth/data flow.
- Client login credentials must be linked to a real Supabase Auth user for second-device or shared-client access to work reliably.
- The codebase includes legacy compatibility for older local workspace data and migration helpers, but the active path is Supabase-first.

## Repository

GitHub repository:

- `dhanbyte/meeshopanal`

This README reflects the current setup and the verified build state of the application.
