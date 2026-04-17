# Elo Code Arena — public deployment version

This version is prepared to run on the public internet instead of only on `localhost`.

## What changed

- Uses **PostgreSQL** with Prisma instead of SQLite for production deployment.
- Includes a **Render Blueprint** in `render.yaml`.
- Backend binds to `0.0.0.0` so it can accept public traffic.
- Production cookies are enabled automatically.
- Frontend and API are served by the same Node service.

## Deploy on Render

1. Put this project in a GitHub repository.
2. Create a new Render Blueprint from that repository.
3. Render will read `render.yaml` and create:
   - one web service
   - one Postgres database
4. When deploy finishes, Render gives you a public URL like:
   - `https://your-app-name.onrender.com`

## Local development

Use PostgreSQL locally, then run:

```bash
cd backend
node -e "require('fs').copyFileSync('.env.example','.env')"
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Then open `http://localhost:3001`.

## Important

For public deployment, do **not** use the old SQLite version. Use this version with Postgres.


## Username-only auth

This build removes email from the user-facing auth flow. New accounts use only:

- username
- password

For deployment compatibility, the backend still fills an internal placeholder email value in the database so existing Postgres setups do not need a destructive schema change.
