# Rollcall attendance tracker

Live: https://attendance-tracker-gamma-orpin.vercel.app

Next.js app on Vercel with private Vercel Blob storage.

## Use

1. Create an account with a username and password (at least 10 characters). Each account has its own private workspace. Save these credentials; password recovery is not implemented.
2. Choose **New class**, name it, and upload a CSV with `name` (or `first_name,last_name`) and optional `student_id`. Plain one-name-per-line CSVs also work. Limits: 1,000 students / 500 KB.
3. Try the downloadable **20 fake students** sample: [sample-roster.csv](public/sample-roster.csv). All names are fictional. For example, use `DEMO001` to check in Avery Brooks.
4. Display or download the QR code, or copy the student check-in link. Students do not need accounts.
5. View check-ins (refreshes every 15 seconds), export a CSV, and close check-in.
6. Return to the same class after signing in on any device. **Take attendance again** reuses the roster with a fresh QR and empty attendance record. **Attendance history** retains previous sessions.
7. Use the light/dark toggle on any page. The initial theme follows your device; your choice is saved in the browser.

Existing anonymous workspaces can be imported after signing in using the banner shown on their original browser, or by opening the original private teacher link. The first account that imports a legacy workspace owns it. Old bearer keys no longer authorize teacher API access.

## Security and limitations

Passwords use salted scrypt hashes. Sessions use random opaque tokens, hashed at rest, and 30-day HttpOnly/SameSite cookies (Secure over HTTPS). Logout revokes the server session. Teacher read/write routes enforce ownership server-side. Authentication attempts are throttled by username and IP in 15-minute windows; counters use Blob listing and are not transactional under simultaneous requests. No email verification, password recovery, invitations, or shared accounts are provided.

Student check-in is self-reported: the QR link plus a roster name/ID is sufficient. It does not verify identity or physical presence. The public endpoint does not expose the roster. Attendance sessions and check-ins are immutable separate objects, avoiding shared-record overwrite races. A check-in already in progress when the teacher closes a session may finish.

## Development and validation

```sh
npm install
vercel env pull .env.local
npm run dev
npm test
npm run build
# With the dev server running (creates and removes test-owned records):
node --env-file=.env.local tests/auth.integration.mjs
# Against deployment:
TEST_BASE_URL=https://attendance-tracker-gamma-orpin.vercel.app node --env-file=.env.local tests/auth.integration.mjs
```

Requires `BLOB_READ_WRITE_TOKEN` for a private Blob store. Secrets are ignored by Git. Run `vercel --prod` to deploy.
