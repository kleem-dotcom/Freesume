# FREESUME v9 — Cloud Database + Secure Payments

FREESUME is a resume builder with one free Essential template and ₹10 premium templates.

## What v9 adds
- PostgreSQL/Supabase persistence via `DATABASE_URL`.
- Automatic database schema creation on startup.
- Accounts, sessions, resumes, orders, verified payments, webhook events and download history stored in PostgreSQL.
- Local JSON storage remains as a development fallback when `DATABASE_URL` is absent.
- Server-side authorization for premium PDF downloads.
- Razorpay order-to-account-to-template matching.
- Idempotent payment verification and webhook event recording.
- `/healthz` checks the database when PostgreSQL is configured.
- Render + Docker deployment configuration.

## Local development
1. Install Node.js 20+.
2. `npm install`
3. Copy `.env.example` to `.env`.
4. For a local-only test, leave `DATABASE_URL` unset; JSON storage will be used.
5. Add Razorpay Test Mode credentials for payments.
6. `npm start`
7. Open `http://localhost:3000`.

## Production database
Create a PostgreSQL database (Supabase is one option), then put its connection string in the host's secret/environment settings as `DATABASE_URL`. Do not commit it to GitHub.

The app creates its required tables automatically. For a larger production system, move this to versioned migrations.

## Razorpay
- Keep `RAZORPAY_KEY_SECRET` server-side only.
- Configure a Razorpay webhook endpoint at `/api/webhook` using the same `RAZORPAY_WEBHOOK_SECRET` configured on the server.
- Use the public `RAZORPAY_KEY_ID` only for Checkout initialization.
- Keep Test Mode for testing; switch to Live credentials only after the site, policies and business/account setup are ready.

## Deployment
The included `render.yaml` and `Dockerfile` are ready for a Render-style Docker deployment. Set all `sync: false` values in the deployment dashboard.

## Important production checklist
- Use HTTPS (Render provides TLS for the public service).
- Set strong random `ENTITLEMENT_SECRET` and webhook secret.
- Configure `DATABASE_URL`.
- Configure Razorpay webhook URL and secret.
- Add Privacy Policy, Terms, Refund/Cancellation Policy and contact/support information before taking real payments.
- Test registration, login, resume saving, free PDF, failed payment, successful Test Mode payment, premium PDF, duplicate verification and webhook delivery.
- Consider adding email verification, password reset, rate limiting and automated backups before significant traffic.
