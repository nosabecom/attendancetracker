# Candidate: freeze known HTTP writers with the project firewall

Status: read-only inventory completed; containment remains a design proposal.
No firewall rule has been saved,
staged or activated by this work. A new-rule form was inspected and closed.
This is not evidence of a completed writer freeze or permission to cut over.

## Read-only inventory — November 10

After Astra accepted a maximum of 12 explicit inventory requests, root used
seven: an initial CLI-authenticated project read returned 403, five controlled
owner-dashboard reads returned 200, then a refreshed-CLI identity read returned
200. The initial failure and all seven reservations remain in one private
ledger. The existing CLI performed one supported authentication-refresh/query
invocation; its internal control calls are separately unknown. Browser
navigation/background traffic is also separate and unmetered. See the
[safe inventory](./measurements/blob-firewall-readonly-inventory.json).

The returned pages were complete: 50 Ready deployments, 14 aliases and one
project domain, with every alias's deployment present in the deployment list.
The exact owned project/team matched, Git remained disconnected, project cron
definitions were empty and no project protection-bypass entry was observed.
The firewall endpoint returned no active custom configuration or pending draft.
This does not prove platform-wide exception absence, WAF execution on every
URL, historical runtime limits or completion of downstream writes. No rule was
saved, staged or activated. No mutation/verification/rollback allocation exists.

## Evidence and scope

Nosa confirmed the production Blob credential and app deployment are used only
by this project and our work. The Git connection remains removed and manual
deployment/environment-copy holds remain. Current source has no client write
token issuer, server cron, queue or detached background writer. Local/operator
writers must remain stopped; HTTP containment does not revoke their credentials.

Installed Vercel CLI 62.1.0 supports project-scoped custom firewall rules and
lists both Preview and Production as environment conditions. Its supported
configuration flow is GET active configuration, PATCH the draft with
`rules.insert`, then POST that draft version's activation endpoint. Do not use
PUT to replace a configuration. Project pause alone covers only the active
production deployment and is insufficient for old preview URLs.

The project dashboard showed an active firewall, zero custom/enforced rules and
capacity for 40 custom rules. A blank new-rule form opened without an upgrade
prompt. This is useful entitlement evidence, not a successful activation test.
The [custom-rule documentation](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules)
says applying changes takes effect without redeployment. The
[configuration reference](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration)
lists Preview/Production environment matching and says Deny stops further rule
execution. The
[pricing page](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing)
says ordinary custom rules are free and denied traffic does not incur CDN
Requests or Fast Data Transfer. Do not enable rate limiting, managed rulesets,
paid add-ons, plan changes or persistent actions for this freeze.

Documentation's production-publication wording alone does not establish that
every existing deployment URL is covered. Live scope/bypass verification and a
drain bound remain necessary. Static-token-only reasoning is another candidate,
but historical runtime environment/SDK evidence remains incomplete.

## Smallest proposed continuation

The inventory above implements the bounded read-only portion. Before any mutation,
obtain separate Astra review of an exact execution plan. The original proposal was to reserve a
separate bounded read-only control inventory (proposed maximum 12 explicit
requests, no retries or redirects). Bind requests to the exact owned team and
project using existing authentication privately. Read project identity, current
active/draft configuration, deployment/alias inventory and relevant execution
limits. Stop before mutation if inventory cannot be completed inside the bound;
do not silently enlarge it or infer completeness from a truncated page.

The read-only phase must establish:

1. Exact project/team binding, entitlement, active configuration/version and any
   pre-existing draft, bypass, custom rule or provider-level exception.
2. All known still-invocable production, preview, historical and custom-domain
   writer URLs, plus any provider scheduling or external/local writer.
3. Whether a first-priority Deny on every path can cover those HTTP writers,
   including relevant bypass conditions. A response from deployment protection
   is not evidence that the new firewall rule executed.
4. A justified upper bound for admitted requests and detached work to finish
   after ingress closes, including already-admitted downstream Blob writes.
   Function termination alone does not establish downstream completion. No
   elapsed-time guess substitutes for this bound.

Then prepare an exact, separately reviewed mutation/probe/rollback allocation
based on that inventory. The intended rule is one temporary, highest-priority
project rule matching path prefix `/`, with action Deny, no persistent action
and no paid feature. Preserve unrelated active/draft configuration; never
activate someone else's pending draft. Verify the chosen rule's identity,
priority, activation and coverage before declaring the known HTTP writers
contained. Keep operator/deployment holds and drain admitted work.

Rollback must remove only the owned rule and preserve concurrent configuration.
An uncertain mutation is not retried. Do not silently reopen legacy writers
after a final snapshot: any later accepted Blob attendance requires a new
consistent capture/reconciliation before cutover. Prefer the final freeze only
when the separately required hosted checks and import are ready.

This proposal changes no existing hosted-preview, export or spending allocation.
It does not reopen OIDC probing or require revoking hypothetical principals when
the closed known-writer inventory and supported containment are sufficient.
