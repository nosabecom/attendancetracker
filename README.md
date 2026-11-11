# Rollcall attendance tracker

Live: https://attendance-tracker-gamma-orpin.vercel.app

Next.js on Vercel, with Convex for authentication, classes, rosters and attendance. The historical Blob records have been imported and independently reconciled. Existing teachers can sign in again with their original username and password.

## Use

1. Sign in or create a username/password account. Passwords require at least 10 characters; password recovery is not implemented.
2. Create a class and import a CSV with `name` (or `first_name,last_name`) and optional `student_id`. One name per line also works. Rosters support up to 1,000 students and 500 KB. The [sample roster](public/sample-roster.csv) contains fictional students.
3. Start attendance, then display the QR code or share its student link. Students enter a roster name or ID and do not need an account.
4. View live attendance, mark or undo excuses, export CSV, and close check-in. An excuse takes display priority while preserving the original check-in.
5. Use **Take attendance again** for a fresh session with the saved roster. History preserves each session's roster and original facts. Roster edits apply to subsequent sessions.

Choose **Teacher access** to add an existing teacher by username. Shared teachers can use the assigned class; only its owner manages access. Concurrent roster/access edits detect revision conflicts.

Existing anonymous workspaces can be claimed after signing in from their original browser or private teacher link. Old bearer keys do not directly authorize teacher operations.

## Security and behavior

Convex Auth manages tokens and fixed-lifetime sessions. Every protected operation verifies the current session and class access; logout revokes the server session. Authentication cookies are HttpOnly, Secure over HTTPS, and SameSite Lax. Imported password hashes retain their original scrypt behavior. There is no email verification or password recovery.

Public check-in exposes session metadata and the submitted student's result, without returning the roster. Attendance is self-reported; the link and a matching roster name/ID do not verify physical presence. Closing and check-in are serialized by the database.

Selected class/session subscriptions replace attendance polling. History is paginated, and CSV export reads a fresh server snapshot. Disconnection or authentication recovery blocks private views and exports until revalidation. Gateway admission uses atomic IP and submitted-identity limits; authentication and maintenance work is separate from attendance updates.

Vercel Analytics and Speed Insights remove query strings and fragments from measured URLs. The app sends no custom student-name/ID events.

## Development and deployment

Use pnpm and the pinned Node version in `.nvmrc`.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test:backend
pnpm build
```

Configure an isolated Convex development backend and `.env.local` using [.env.example](.env.example). Configure Convex Auth signing keys on that backend. Next and Convex must share the environment-specific server gateway key and audience; public Convex cloud/site URLs must identify that same deployment. Secrets are ignored by Git.

Production uses `tremendous-elk-298`. Its frontend environment is configured separately from backend publication; frontend builds must not implicitly publish or re-import the backend. `main` is the production branch. Dependabot previews remain disabled, and required GitHub verification covers installation, dependency auditing, backend integration tests and both frontend build configurations.

See [cutover and recovery](docs/convex-cutover.md), [production reconciliation](docs/production-reconciliation.md), and [hosted release evidence](docs/hosted-release-access.md). Migration snapshots contain private account and student records and are kept outside Git, including a verified backup outside the worktree. Production recovery uses those snapshots and forward repair; the archived Blob backend does not contain new Convex attendance.
