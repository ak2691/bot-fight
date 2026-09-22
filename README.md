# Bot Fight

Bot Fight is a game where players build bots using a structured logic system and send them into deterministic arena fights.

**Official website:** [botfightonline.com](https://botfightonline.com)

## Features

Players can:

- Build and test bots in the browser
- Choose abilities and loadouts
- Solve bot-building puzzles
- Play rated 1v1 and 2v2 matches
- Create private custom lobbies

Bots are represented as declarative configurations of **logic blocks, conditions, targets, actions, and values** rather than typed code.

The server validates submissions and owns the authoritative:

- Simulation
- Match result
- Rating
- Replay data

## Architecture

```text
React / Vite
├── Visual bot editor and practice arena
├── PixiJS arena and replay rendering
├── REST + STOMP/WebSocket client
└── Matchmaking, puzzles, profiles, and lobby UI
            │
            ▼
Spring Boot ── PostgreSQL
├── Authentication, sessions, CSRF, and OAuth
├── Matchmaking, parties, and custom lobbies
├── Validation and persistence
├── Authoritative deterministic simulation
└── Ratings and cached read models