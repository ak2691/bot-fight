# Legacy path decisions

This note records the source-verified disposition for AUD-15. Static inspection
does not establish what deployed instances or production data still use.

## Parties and the V38 schema

**Supported behavior:** party rosters and invitations are process-local runtime
state. [`PartyService`](../server/src/main/java/com/example/botfight/service/party/PartyService.java)
holds parties, members, and invites in maps; its `Party`, `PartyMember`, and
`PartyInvite` objects are actively used as transient data carriers. Restarting
the process discards that state. [`PartyInviteCleanupService`](../server/src/main/java/com/example/botfight/service/party/PartyInviteCleanupService.java)
asks the service to expire transient invites every minute.

**Inactive persistence path:** [`PartyRepository`](../server/src/main/java/com/example/botfight/repository/PartyRepository.java),
[`PartyMemberRepository`](../server/src/main/java/com/example/botfight/repository/PartyMemberRepository.java),
and [`PartyInviteRepository`](../server/src/main/java/com/example/botfight/repository/PartyInviteRepository.java)
have no production persistence calls. Their only production references are the
unused repository parameters forwarded by `PartyService` constructors. The
focused service test verifies that these repositories do not save party,
member, or invite objects ([`PartyServiceTest`](../server/src/test/java/com/example/botfight/service/PartyServiceTest.java)).
This makes the repository-backed behavior inactive; it does not make the
transient domain classes dead code.

[`V38__parties_and_party_invites.sql`](../server/src/main/resources/db/migration/V38__parties_and_party_invites.sql)
created `parties`, `party_members`, and `party_invites` with foreign keys,
constraints, and indexes. The server context describes Flyway history as
append-only. Keep V38 unchanged. Do not infer that its tables are empty or safe
to remove from the current service implementation.

The audit's “unused retention constant” description is not present in the
current party service code: `PartyService.INVITE_VALIDITY` is used when invites
are created, and invite cleanup is scheduled every minute. A party-specific
retention constant was not found in the current party service/domain sources.

**Disposition:** retain the process-local party contract and transient domain
carriers. Treat repository methods and their `PartyService` wiring as
legacy/inactive candidates. The JPA mappings remain present in code, so removing
them is a separate compatibility change. Before removing repository types or
adding a forward migration to remove tables, obtain production table counts and
usage evidence, check reporting/support integrations and backups, and confirm
every supported app version and rollback path is compatible. Any schema
removal must be a new forward Flyway migration after that review; never rewrite
V38.

## Replay recorders and delivery modes

**Active rated path:** [`MatchRoundResolutionService`](../server/src/main/java/com/example/botfight/service/match/resolution/MatchRoundResolutionService.java)
calls `MatchSimulationService.buildDuelReplay`, which uses
`DuelSimulationService.simulateCompact` and retains compact `MatchReplayDTO`
frames. [`MatchReplayService`](../server/src/main/java/com/example/botfight/service/match/replay/MatchReplayService.java)
can deliver those frames either as one full compact payload or in batches.
`ReplayDeliveryMode.FULL` is therefore an active supported mode, not the older
full recorder identified below.

[`application.properties`](../server/src/main/resources/application.properties)
binds `REPLAY_DELIVERY_MODE` to `botfight.replay.delivery-mode`, defaulting to
`batched`. [`server/.env.prod.example`](../server/.env.prod.example) also shows
`batched`; that example does not prove the value used by a deployed service.

**Legacy/inactive candidate:** `DuelSimulationService.simulate` selects
`FullReplayRecorder`, which retains a per-tick `MatchPlaybackDTO`;
`MatchSimulationService.buildDuelPlayback` is its wrapper. There is no call to
that wrapper in the current production source tree, while the active rated path
uses the compact wrapper. Tests still exercise the older path. Keep it until
deployed call telemetry, supported-version checks, and external/serialized
consumer review establish that no production consumer depends on it.

Before changing replay support, verify the deployed `REPLAY_DELIVERY_MODE`,
server versions still in service, and socket/replay consumers. This checkout
does not expose production environment values, runtime call metrics, external
consumers, or database contents, so it cannot establish the actual deployed
mode, historical recorder usage, or V38 table row counts.
