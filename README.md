

Bot Fight is a game where players build bots using a structured, logic system and send them into deterministic arena fights.

Official website: botfightonline.com

Players can:

Build and test bots in the browser

Choose abilities and loadouts

Solve bot-building puzzles

Play rated 1v1 and 2v2 matches

Create private custom lobbies

Bots are represented as declarative configurations of logic blocks, conditions, targets, actions, and values rather than typed code. The server validates submissions and owns the authoritative simulation, match result, rating, and replay data.

Architecture
React / Vite
  ├─ Visual bot editor and practice arena
  
  ├─ PixiJS arena and replay rendering
  
  ├─ REST + STOMP/WebSocket client

  └─ Matchmaking, puzzles, profiles, and lobby UI
           
  
Spring Boot ── PostgreSQL

  ├─ Authentication, sessions, CSRF, and OAuth
  
  ├─ Matchmaking, parties, and custom lobbies
  
  ├─ Validation and persistence
  
  ├─ Authoritative deterministic simulation
  
  └─ Ratings and cached read models
  
Frontend

frontend/ contains the React 19 + Vite client, including the bot editor, practice arena, matchmaking UI, puzzles, and PixiJS replay renderer.

Backend

server/ contains the Java 21 + Spring Boot 4 application. It handles authentication, matchmaking, validation, persistence, ratings, and the authoritative match simulation.

PostgreSQL stores application data, Flyway manages migrations, and Caffeine provides bounded in-process caching.


Deployment

Production uses separate frontend and backend deployments:

The Spring Boot backend is built as a Docker image and deployed to AWS Lightsail with Docker Compose.

The Vite frontend is built and deployed to S3 behind CloudFront.

GitHub Actions runs checks on pull requests and deploys affected components on pushes to main.




