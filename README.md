Bot Fight

Bot Fight is a competitive multiplayer programming game where players build bots using a structured, allowlisted logic system and send them into deterministic arena fights.

Players can:

Build and test bots in the browser
Choose abilities and loadouts
Solve bot-building puzzles
Play rated 1v1 and 2v2 matches
Create private custom lobbies

Bots are represented as declarative configurations of logic blocks, conditions, targets, actions, and values rather than arbitrary executable code. The server validates submissions and owns the authoritative simulation, match result, rating, and replay data.

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

Repository layout
frontend/ — React/Vite client and game UI
server/ — Spring Boot API and simulation server
docs/ — gameplay contracts, guides, and checklists
docker-compose.yml — local development stack
docker-compose.prod.yml — production backend stack
.github/workflows/cicd.yml — CI/CD workflow
Requirements

For local development:

Docker and Docker Compose v2
Node.js 20+ and npm
Java 21

Docker Compose is the recommended setup.

Run locally

Copy the example environment files:

macOS / Linux
cp server/.env.example server/.env
cp frontend/.env.example frontend/.env
docker compose up --build
Windows PowerShell
Copy-Item server/.env.example server/.env
Copy-Item frontend/.env.example frontend/.env
docker compose up --build

Services:

Frontend: http://localhost:5173
Backend: http://localhost:8080
pgAdmin: http://localhost:5050
PostgreSQL: localhost:5432

Google OAuth and SMTP require their corresponding values in server/.env.

To stop the stack while keeping the database volume:

docker compose down
Run components directly
Frontend
cd frontend
npm ci
npm run dev
Backend

macOS/Linux:

cd server
./mvnw spring-boot:run

Windows:

cd server
.\mvnw.cmd spring-boot:run
Tests

Frontend:

cd frontend
npm test
npm run lint
npm run build

Backend:

cd server
./mvnw test

Windows:

.\mvnw.cmd test
Deployment

Production uses separate frontend and backend deployments:

The Spring Boot backend is built as a Docker image and deployed to AWS Lightsail with Docker Compose.
The Vite frontend is built and deployed to S3 behind CloudFront.

GitHub Actions runs checks on pull requests and deploys affected components on pushes to main.




