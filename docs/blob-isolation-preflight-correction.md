# One-field preflight correction, retaining the original phase

Status: execution stopped before mutation; this is a proposed narrow continuation
for Astra review. [The stop record](./measurements/blob-isolation-preflight-stop.json)
retains the first management read and the original ISOLATION1 allocation.

The first owned project GET returned, and local ownership/Git checks passed.
The operator then incorrectly checked a deployment-style `functionTimeout`
property on the project resource objects. A project expresses this default as
`defaultResourceConfig.functionDefaultTimeout`; the existing retained inventory
records 300 there. Deployment detail records separately use
`config.functionTimeout`. The failed predicate did not establish a changed
provider limit. No rotation, connection removal, capture invocation or static
credential probe occurred.

Correct only that predicate:

```js
const timeout = project.defaultResourceConfig?.functionDefaultTimeout;
if (timeout !== 300) stop();
```

The first project's full response was not retained before the local stop, so
the corrected field needs one deliberate fresh owned-project GET. Persist its
sanitized identity, Git, production target and resource configuration before
testing the predicates. Retain no environment value fields. This is not an
automatic transport retry and is not claimed as the first project read.

Before continuation, append an immutable addendum granting **exactly one extra
project read** to the existing phase. Keep its original ALLOCATION, failed
preflight, spent request and all action reservations unchanged. The cumulative
explicit-read ceiling becomes **18**, with one already used; original
management/environment/control/log operations remain otherwise unchanged.
The provider action ceilings remain one rotation, one owned connection removal,
one capture invocation and the three original static LIST checks. No margin is
borrowed and no new phase/path resets the failed attempt.

After scoped acceptance, refresh the reviewed HEAD, headroom, operator hold and
paths, perform that one corrected read, then complete the previously unspent
deployment/environment preflight. A value other than 300, incomplete ownership
or metadata, unexpected deployment, failure or ambiguity stops before rotation.
Retain both old and continuation outcomes. All subsequent isolation and drain
conditions remain those in the [original operation contract](./blob-final-isolation-plan.md).
No additional export, hosted creation, production import or traffic switch is
authorized by this correction.
