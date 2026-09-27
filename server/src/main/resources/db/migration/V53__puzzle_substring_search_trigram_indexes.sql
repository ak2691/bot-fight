-- Keep the published puzzle catalog's case-insensitive substring search
-- indexed as the catalog grows. The lower(...) expressions match the search
-- predicates in PuzzleRepository.searchPublished.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX puzzles_name_lower_trgm_idx
    ON puzzles USING gin (lower(name) gin_trgm_ops);

CREATE INDEX puzzles_description_lower_trgm_idx
    ON puzzles USING gin (lower(description) gin_trgm_ops);
