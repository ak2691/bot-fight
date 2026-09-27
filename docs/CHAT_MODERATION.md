# Chat report and moderation contract

Accepted match and custom-lobby messages receive a server-generated UUID. The
server stores normalized text, sender identity, context type and ID, timestamp,
moderation metadata, and the user IDs in the server-computed delivery roster.
Client report requests contain only the message UUID, reason category, and
optional note. The server authorizes requests from the stored roster and does
not accept client-supplied sender or context evidence.

An open report copies the message snapshot and recipient roster. It therefore
remains reviewable after short-lived chat evidence expires. A `(reporter,
message)` unique key makes repeat submissions idempotent. Report acknowledgments
do not reveal whether a target exists or qualified for review.

## Retention and bounds

- Unreported chat evidence expires after seven days by default. Configure with
  `botfight.chat-moderation.evidence-retention`.
- Evidence referenced by an open report is retained. Resolving or deleting the
  report allows the next cleanup pass to remove expired evidence.
- Resolved, dismissed, and actioned reports are retained for 90 days by default,
  then removed by the hourly cleanup job. Configure with
  `botfight.chat-moderation.resolved-report-retention`.
- A reporter may have at most five open reports by default. Configure with
  `botfight.chat-moderation.max-open-reports-per-user`.
- Public notes are limited to 300 code points. Admin resolution notes are
  limited to 500 code points. Message text remains bounded by chat validation
  at 280 code points.
- Reporter request buckets limit five report attempts per minute, with one
  attempt for the same reporter/target-user pair per ten minutes. The target
  user ID comes from the stored evidence. These in-memory
  buckets are per application instance; the database unique key and row-locked
  open-report cap apply across instances.

## Moderator workflow

Only an account with the server-side `ADMIN` role can list, inspect, resolve, or
delete reports. Resolutions are `ACTIONED`, `DISMISSED`, or `RESOLVED`. Open
reports cannot be hard-deleted. Admin actions and retention purges leave an
audit record containing actor, action, time, and status detail; audit records do
not contain message text and survive report deletion. React renders report text
as text content, never as HTML. Application code does not log chat contents.
