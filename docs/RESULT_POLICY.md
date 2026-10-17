# Match result and rating policy

An authoritative round must finish before a draw can affect rating. A match
that ends during initial loadout selection, or through mutual disconnection
before the first round is simulated, is recorded as a draw with no rating
change. It still counts as a completed match in the profile. Once a round has
been simulated, the normal rated draw calculation applies.

The series winner is determined only by round wins, for both solo and team
matches. Equal round wins at the end of the series means a draw. Damage dealt,
remaining HP, survival time, and player slot never break a series tie.

Round scores and submitted code history remain tied to the server-owned match
and round. If terminal result persistence fails, resolution can retry the same
round without consuming its in-memory submissions. Code history persistence is
idempotent by match, round, phase, and user to handle a prior partial commit.
