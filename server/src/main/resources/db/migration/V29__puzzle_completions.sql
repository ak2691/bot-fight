CREATE TABLE puzzle_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    puzzle_id UUID NOT NULL,
    solved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT puzzle_completions_user_puzzle_unique UNIQUE (user_id, puzzle_id),
    CONSTRAINT puzzle_completions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT puzzle_completions_puzzle_fk FOREIGN KEY (puzzle_id) REFERENCES puzzles (id) ON DELETE CASCADE
);

CREATE INDEX puzzle_completions_user_solved_idx
    ON puzzle_completions (user_id, solved_at DESC, id DESC);
