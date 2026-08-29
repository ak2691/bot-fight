-- Keep puzzle roster and team-size columns aligned with the Java int mappings.
-- V39 introduced these columns as SMALLINT, while the corresponding entities
-- use int, which Hibernate validates as INTEGER in PostgreSQL.

ALTER TABLE puzzles
    ALTER COLUMN player_team_size TYPE INTEGER USING player_team_size::integer,
    ALTER COLUMN opponent_team_size TYPE INTEGER USING opponent_team_size::integer;

ALTER TABLE puzzle_bots
    ALTER COLUMN team_number TYPE INTEGER USING team_number::integer,
    ALTER COLUMN slot TYPE INTEGER USING slot::integer;
