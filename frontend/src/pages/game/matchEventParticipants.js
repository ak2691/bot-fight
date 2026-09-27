export const MATCH_EVENT_SCHEMA_VERSION = 2;

export function matchEventParticipants(event) {
    return Number(event?.eventSchemaVersion) === MATCH_EVENT_SCHEMA_VERSION
        && Array.isArray(event?.players)
        ? event.players.filter((participant) => participant != null)
        : [];
}

export function matchEventViewer(event) {
    const viewerUserId = event?.viewerUserId;
    if (viewerUserId == null) return null;
    return matchEventParticipants(event).find(
        (participant) => String(participant.userId) === String(viewerUserId),
    ) ?? null;
}

export function matchEventOpponent(event) {
    const participants = matchEventParticipants(event);
    const viewer = matchEventViewer(event);
    if (!viewer) return null;
    const otherParticipants = participants.filter(
        (participant) => String(participant.userId) !== String(viewer.userId),
    );
    const viewerTeam = participantTeamNumber(viewer);
    return otherParticipants.find(
        (participant) => participantTeamNumber(participant) !== viewerTeam,
    ) ?? otherParticipants[0] ?? null;
}

function participantTeamNumber(participant) {
    const teamNumber = Number(participant?.teamNumber);
    if (Number.isFinite(teamNumber) && teamNumber > 0) return teamNumber;
    return Number(participant?.slot) === 1 ? 1 : 2;
}
