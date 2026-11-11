# Dependency merge validation

On November 9, 2026, PR #13 had conflicts with main's dependency update
`05609e4` (PR #14). The resolution retains main's Next.js 16.4.4 and
lucide-react 1.66.0, alongside the migration dependencies, Convex Auth 0.0.96
patch and Zod security override. No application code changed.

Local validation passed:

- Frozen-lockfile installation, followed by an offline frozen verification.
- 365 Node unit tests and 217 Convex backend tests.
- Strict Convex TypeScript checking.
- Both Blob and Convex Next production builds under Node 24.22.1.
- `pnpm audit`: no known vulnerabilities at the time of the check.
- Lockfile supply-chain verification and whitespace checks.

Builds used a sanitized process environment. Local dotenv keys were supplied as
empty process values, with only the selected backend and placeholder public
Convex URLs supplied for compilation. No deployment, new Blob access probe or
hosted Convex workload was performed. Existing live evidence remains associated
with its original source heads and does not constitute hosted validation of the
new dependency combination.

Vercel's recovery case was checked and still awaited a human response. The
deployment/environment-copy hold remains active, production still uses Blob,
and the stopped access-probe allocations remain spent. Data export,
reconciliation, outstanding hosted checks and final cutover approval remain
separate requirements. The test suite remains intact.
