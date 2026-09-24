# Shangrilas PMS — Foundation

This is the first foundation module for a production-oriented hotel PMS.

## Stack

- React + TypeScript + Vite
- Cloudflare Workers
- Cloudflare D1
- Versioned SQL migrations
- Multi-tenant data model
- Role/permission foundation
- Session-token foundation
- Audit-log foundation

## Step 1 scope

Implemented in this foundation:

1. Organization and hotel tenancy model
2. Users and roles
3. Permissions and role-permission mapping
4. Sessions
5. Audit logs
6. Hotel profile
7. Initial API health endpoint
8. Authentication API foundation
9. Protected `/api/me` endpoint
10. Clean migration structure

Reservation, room inventory, billing, housekeeping, reports, OTA/channel-manager, and SaaS subscription modules are intentionally NOT included yet.

## Setup

1. Create the project with this repository.
2. Install dependencies:
   `npm install`
3. Create a D1 database:
   `npx wrangler d1 create shangrilas-pms`
4. Put the returned database ID into `wrangler.jsonc`.
5. Apply local migration:
   `npx wrangler d1 migrations apply shangrilas-pms --local`
6. For production:
   `npx wrangler d1 migrations apply shangrilas-pms --remote`
7. Start:
   `npm run dev`

## First admin bootstrap

The first admin user should be created only through a protected bootstrap flow. Set `PMS_BOOTSTRAP_SECRET` as a Worker secret and call the bootstrap endpoint once. After the first successful bootstrap, disable/remove the bootstrap secret and use normal user administration.

The bootstrap implementation is deliberately isolated so the production deployment can add an additional one-time lock before opening the endpoint publicly.

## Important

Do not use Google Sheets as the PMS database. Sheets can be added later as an export/report destination.

This foundation is the starting point. Each later PMS module should be added through a new migration and tested before the next module is introduced.
