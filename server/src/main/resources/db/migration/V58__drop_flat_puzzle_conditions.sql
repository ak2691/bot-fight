-- Puzzle outcome rules live only in logic_configuration (roots of kind win, lose and modify).
-- The flattened copies were redundant.
ALTER TABLE puzzles DROP COLUMN win_conditions;
ALTER TABLE puzzles DROP COLUMN lose_conditions;
