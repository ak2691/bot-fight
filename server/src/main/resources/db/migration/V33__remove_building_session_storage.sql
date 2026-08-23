-- Building-phase deadlines are owned by the in-memory MatchSession.
-- The old server-owned building-session records are no longer needed.
DROP TABLE IF EXISTS building_sessions;
