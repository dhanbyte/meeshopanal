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
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-public-key
```

The browser uses only the Supabase URL and publishable key. Never put a `sb_secret_*` key or JWT signing secret in a `VITE_` variable, browser bundle, or source file.

If Supabase is not configured, the app offers an offline demo login: `admin@gmail.com` / `admin123`. It opens the temporary sample workspace only. The demo credentials do not create or access Supabase accounts or live records. Configure Supabase before using the app for real client orders, returns, or wallet payments.

## Supabase database setup

The base database schema and Row Level Security rules are in `supabase/migrations/20261114000000_parcel_desk_core.sql`. In the Supabase Dashboard, open **SQL Editor**, paste that file, and run it once. It creates the client, shipment, return, wallet ledger, profile and staff-assignment tables; private label/return storage buckets; and database functions that keep order, return and wallet updates transactional.

Create the first admin in **Authentication → Users**, then add its profile in SQL Editor using the real Auth user ID:

```sql
insert into public.profiles (id, role, active, name)
values ('AUTH_USER_UUID', 'admin', true, 'Workspace Admin')
on conflict (id) do update set role = 'admin', active = true;
```

Client logins are created from a client record in the app. The `admin-client-login` Edge Function links that Auth user to the client profile. From this folder, sign in to the Supabase CLI, link your project, then deploy it:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy admin-client-login
```

Create a server-only API key named `parceldesk_edge` in **Project Settings → API Keys**. The two admin Edge Functions read that key from Supabase's runtime-provided `SUPABASE_SECRET_KEYS` map; never put its value in a `VITE_` variable or browser code. Deploy both functions after updating them:

```sh
npx supabase functions deploy admin-client-login
npx supabase functions deploy admin-delete-ledger-entry
```

Staff profiles and their client assignments belong in `profiles` and `staff_client_access`.

This is a clean Supabase start; old Firebase records are not imported. Keep an export of any existing records before switching the live workspace.

Client login creation and password resets use the `supabase/functions/admin-client-login` Edge Function. Deploy it with `supabase functions deploy admin-client-login`; its service-role key must remain a server-side secret. The function confirms managed client accounts automatically, so clients can sign in without waiting for an email confirmation. Client deletion is a soft delete (`active=false`) so its orders and ledger history remain available.

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

- Supabase Auth, database functions, RLS and private Storage are the active auth/data path.
- Client login credentials must be linked to a real Supabase Auth user for second-device or shared-client access to work reliably.
- Wallet entries are posted through a database function, so each ledger entry and balance update commit together. Corrections preserve the original history.

## Repository

GitHub repository:

- `dhanbyte/meeshopanal`

This README reflects the current setup and the verified build state of the application.
