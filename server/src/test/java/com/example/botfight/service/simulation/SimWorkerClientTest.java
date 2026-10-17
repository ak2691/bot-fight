package com.example.botfight.service.simulation;

import static org.assertj.core.api.Assertions.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import com.example.botfight.DTO.match.MatchReplayDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.limits.RateLimitExceededException;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import com.example.botfight.service.puzzle.PuzzleAttemptService;
import com.example.botfight.service.puzzle.PuzzleService;
import com.example.botfight.service.puzzle.PuzzleSimulationAdmissionControl;
import com.example.botfight.service.simulation.SimulationRequest.*;
import com.sun.net.httpserver.HttpServer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class SimWorkerClientTest {
    private final JsonMapper mapper=new JsonMapper();
    private final DuelSimulationRequest request=new DuelSimulationRequest(UUID.randomUUID(),"duel-v1",Long.MAX_VALUE,
            new DuelArenaRequest(1200,1200,200),List.of());
    private String response() { return """
        {"engineVersion":"test","replay":{"initialState":{"bots":[]},"frames":[],
        "result":"DRAW","message":"The fight ended in a draw."}}
        """; }
    @Test void transportIsAuthenticatedAndBoundedAndPreservesSeed() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var entered=new CountDownLatch(1); var release=new CountDownLatch(1);
        var secret=new AtomicReference<String>(); var body=new AtomicReference<String>();
        server.createContext("/simulate",e->{
            secret.set(e.getRequestHeaders().getFirst("X-Sim-Worker-Secret"));
            body.set(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)); entered.countDown();
            try {release.await(5,TimeUnit.SECONDS);}catch(InterruptedException x){Thread.currentThread().interrupt();}
            var bytes=response().getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(200,bytes.length);
            e.getResponseBody().write(bytes);e.close();
        }); server.start();
        var metrics=new SimpleMeterRegistry(); var pool=Executors.newSingleThreadExecutor();
        try(var client=client(server,metrics,Duration.ofSeconds(3))) {
            var pending=pool.submit(()->client.simulate(request));
            assertThat(entered.await(2,TimeUnit.SECONDS)).isTrue();
            var puzzle = new PuzzleRequest(mapper.readTree("{}"), mapper.readTree("[]"), mapper.readTree("[]"), 1000, 0);
            assertThatThrownBy(()->client.simulatePuzzle(request, puzzle))
                    .isInstanceOf(com.example.botfight.service.limits.RateLimitExceededException.class);
            assertThat(secret.get()).isEqualTo("test-secret");
            var json=mapper.readTree(body.get());
            assertThat(json.path("seed").asString()).isEqualTo(Long.toString(Long.MAX_VALUE));
            assertThat(json.path("rulesetVersion").asString()).isEqualTo("duel-v1");
            assertThat(json.has("puzzle")).isFalse();
            assertThat(json.has("segments")).isFalse();
            release.countDown();
            var result=pending.get(3,TimeUnit.SECONDS);
            assertThat(result.engineVersion()).isEqualTo("test");
            assertThat(result.replay().result()).isEqualTo("DRAW");
            assertThat(result.puzzle()).isNull();
            assertThat(metrics.get("sim.worker.authority.matches").counter().count()).isEqualTo(1);
        } finally {release.countDown();pool.shutdownNow();server.stop(0);}
    }
    @Test void workerSecretAndPositiveBoundsAreRequired() {
        var metrics=new SimpleMeterRegistry();
        assertThatThrownBy(()->new SimWorkerClient(mapper,metrics,"http://127.0.0.1:1","",Duration.ofSeconds(1),1)).hasMessageContaining("secret");
        assertThatThrownBy(()->new SimWorkerClient(mapper,metrics,"http://127.0.0.1:1","secret",Duration.ZERO,1)).hasMessageContaining("positive");
        assertThatThrownBy(()->new SimWorkerClient(mapper,metrics,"http://127.0.0.1:1","secret",Duration.ofSeconds(1),0)).hasMessageContaining("positive");
    }
    @Test void waitingRatedRoundPrecedesContinuingPuzzleTraffic() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        var firstEntered = new CountDownLatch(1);
        var releaseFirst = new CountDownLatch(1);
        var secondEntered = new CountDownLatch(1);
        var count = new AtomicInteger();
        var secondWasPuzzle = new AtomicReference<Boolean>();
        server.createContext("/simulate", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            boolean isPuzzle = mapper.readTree(body).has("puzzle");
            int ordinal = count.incrementAndGet();
            if (ordinal == 1) {
                firstEntered.countDown();
                try { releaseFirst.await(5, TimeUnit.SECONDS); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            } else if (ordinal == 2) {
                secondWasPuzzle.set(isPuzzle);
                secondEntered.countDown();
            }
            respond(exchange, isPuzzle ? """
                    {"engineVersion":"test","replay":{"initialState":{"bots":[]},"frames":[],
                    "result":"DRAW","message":"draw"},"puzzle":{"status":"failed","elapsedMs":1}}
                    """ : response());
        });
        server.start();
        var threadNumber = new AtomicInteger();
        var pool = Executors.newFixedThreadPool(2,
                runnable -> new Thread(runnable, "rated-permit-test-" + threadNumber.incrementAndGet()));
        try (var client = client(server, new SimpleMeterRegistry(), Duration.ofSeconds(5))) {
            var puzzle = new PuzzleRequest(mapper.readTree("{}"), mapper.readTree("[]"), mapper.readTree("[]"), 1000, 0);
            var first = pool.submit(() -> client.simulatePuzzle(request, puzzle));
            assertThat(firstEntered.await(2, TimeUnit.SECONDS)).isTrue();
            var rated = pool.submit(() -> client.simulate(request));
            // The rated call is queued on the permit before more puzzles arrive.
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            boolean ratedQueued = false;
            while (!ratedQueued && System.nanoTime() < deadline) {
                ratedQueued = Thread.getAllStackTraces().keySet().stream().anyMatch(thread ->
                    thread.getName().equals("rated-permit-test-2") && thread.getState() == Thread.State.TIMED_WAITING
                            && java.util.Arrays.stream(thread.getStackTrace()).anyMatch(frame ->
                            frame.getClassName().equals(Semaphore.class.getName())));
                if (!ratedQueued) Thread.sleep(5);
            }
            assertThat(ratedQueued).isTrue();
            var floodStarted = new CountDownLatch(1);
            var flood = new Thread(() -> {
                for (int i = 0; i < 1000 && secondEntered.getCount() > 0; i++) {
                    floodStarted.countDown();
                    try { client.simulatePuzzle(request, puzzle); }
                    catch (com.example.botfight.service.limits.RateLimitExceededException ignored) { }
                }
            });
            flood.start();
            assertThat(floodStarted.await(2, TimeUnit.SECONDS)).isTrue();
            releaseFirst.countDown();
            assertThat(secondEntered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(secondWasPuzzle.get()).isFalse();
            first.get(2, TimeUnit.SECONDS);
            rated.get(2, TimeUnit.SECONDS);
            flood.join(2000);
        } finally { releaseFirst.countDown(); pool.shutdownNow(); server.stop(0); }
    }
    @Test void timeoutAndMalformedResponseFailAndReleaseCapacity() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/simulate",e->{
            try {Thread.sleep(250);}catch(InterruptedException x){Thread.currentThread().interrupt();}
            try {var bytes="{}".getBytes(StandardCharsets.UTF_8);e.sendResponseHeaders(200,bytes.length);e.getResponseBody().write(bytes);}
            catch(Exception disconnected) {} finally {e.close();}
        });server.start();
        try {
            for(var timeout:List.of(Duration.ofMillis(50),Duration.ofSeconds(2))) {
                var metrics=new SimpleMeterRegistry();try(var client=client(server,metrics,timeout)) {
                    assertThatThrownBy(()->client.simulate(request)).isInstanceOf(RuntimeException.class);
                    assertThatThrownBy(()->client.simulate(request)).isNotInstanceOf(RejectedExecutionException.class);
                    assertThat(metrics.get("sim.worker.authority.failures").counter().count()).isEqualTo(2);
                }
            }
        } finally {server.stop(0);}
    }
    @Test void simulatePuzzleSendsPuzzleRulesAndReturnsOutcome() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var body=new AtomicReference<String>();
        var secret=new AtomicReference<String>();
        server.createContext("/simulate",exchange->{
            body.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
            secret.set(exchange.getRequestHeaders().getFirst("X-Sim-Worker-Secret"));
            respond(exchange,"""
                {"engineVersion":"test","replay":{"initialState":{"bots":[]},"frames":[],
                "result":"BOT_WIN","winnerUserId":"11111111-1111-1111-1111-111111111111","message":"Blue wins."},
                "puzzle":{"status":"solved","elapsedMs":1400}}
                """);
        });
        server.start();
        try (var client=client(server,new SimpleMeterRegistry(),Duration.ofSeconds(2))) {
            var puzzle=new PuzzleRequest(mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}"),
                    mapper.readTree("[{\"type\":\"hp\"}]"),mapper.readTree("[]"),30_000,5_000);
            var result=client.simulatePuzzle(request,puzzle);
            assertThat(result.puzzle()).isEqualTo(new WorkerResult.PuzzleResult("solved",1400));
            assertThat(secret.get()).isEqualTo("test-secret");
            var sent=mapper.readTree(body.get());
            assertThat(sent.path("seed").asString()).isEqualTo(Long.toString(Long.MAX_VALUE));
            assertThat(sent.path("puzzle").path("timeLimitMs").asInt()).isEqualTo(30_000);
            assertThat(sent.path("puzzle").path("initialElapsedMs").asInt()).isEqualTo(5_000);
            assertThat(sent.path("puzzle").path("logicConfiguration")).isEqualTo(puzzle.logicConfiguration());
            assertThat(sent.path("puzzle").path("winConditions")).isEqualTo(puzzle.winConditions());
            assertThat(sent.path("puzzle").path("loseConditions")).isEqualTo(puzzle.loseConditions());
        } finally {
            server.stop(0);
        }
    }
    @Test void rejectsResponsesWithoutAUsableReplayOrPuzzleOutcome() {
        var client=new SimWorkerClient(mapper,new SimpleMeterRegistry(),"http://127.0.0.1:1","secret",Duration.ofSeconds(1),1);
        var noReplay="{\"engineVersion\":\"test\"}";
        var continuing="{\"engineVersion\":\"test\",\"replay\":{\"initialState\":{\"bots\":[]},\"frames\":[],\"result\":\"CONTINUES\"}}";
        var killed="{\"engineVersion\":\"test\",\"replay\":{\"frames\":[],\"result\":\"KO\"}}";
        var noOutcome="{\"engineVersion\":\"test\",\"replay\":{\"frames\":[],\"result\":\"DRAW\"}}";
        var unknownStatus="{\"engineVersion\":\"test\",\"replay\":{\"frames\":[],\"result\":\"DRAW\"},\"puzzle\":{\"status\":\"maybe\",\"elapsedMs\":1}}";
        assertThatThrownBy(()->client.parseResponse(noReplay,false)).hasMessageContaining("no replay");
        assertThatThrownBy(()->client.parseResponse(continuing,false)).hasMessageContaining("unsupported result");
        assertThatThrownBy(()->client.parseResponse(killed,false)).hasMessageContaining("unsupported result");
        assertThatThrownBy(()->client.parseResponse(noOutcome,true)).hasMessageContaining("no puzzle outcome");
        assertThatThrownBy(()->client.parseResponse(unknownStatus,true)).hasMessageContaining("no puzzle outcome");
        assertThat(client.parseResponse(noOutcome,false).replay().result()).isEqualTo("DRAW");
        client.close();
    }

    /** A worker frame as the Node worker serializes it: bots with status effects and an entity. */
    static final String REALISTIC_REPLAY = """
        {"engineVersion":"abc123:0f0e",
         "replay":{
           "initialState":{"bots":[
             {"slot":1,"x":400.0,"y":150.0,"rotation":180.0,"hp":150.0,"maxHp":150.0,
              "abilities":[1,19],"abilityCooldowns":{"1":0},"abilityCharges":{"19":2},"teamNumber":1},
             {"slot":2,"x":800.0,"y":1050.0,"hp":140.0,"maxHp":150.0,"teamNumber":2}]},
           "frames":[
             {"elapsedMs":100,
              "bots":[
                {"slot":1,"x":401.5,"y":150.0,"rotation":180.0,"hp":149.0,
                 "statusEffects":[{"type":"bleed","mode":"duration","remainingMs":2000,"tickMs":500,
                   "tickElapsedMs":100,"source":"melee","sourceSlot":2,"abilityId":3,
                   "effects":[{"type":"damage","mode":"tick","amount":5.0,"multiplier":1.0,"durationMs":0,
                     "movementMultiplier":1.0,"rotationMultiplier":1.0,"damageModifier":0.25,
                     "excludedDamageSourceTypes":["fire"],"rounding":"truncate_tenths"}]}],
                 "abilityCooldowns":{"1":1200},"triggeredAbility":1,"preparingAbility":19,"preparingMs":300,
                 "teamNumber":1},
                {"slot":2,"x":800.0,"y":1050.0,"rotation":0.0,"hp":140.0,"teamNumber":2}],
              "entities":[
                {"id":"hunter-7","type":"hunterDrone","abilityId":5,"x":500.0,"y":300.0,"size":20,
                 "rotation":90.0,"hp":3,"velocityX":1.5,"phaseId":"live","phaseTimerMs":200,
                 "statusEffects":[{"type":"slow","remainingMs":500,"intervalMs":0,"tickElapsedMs":0,
                   "amount":0.0,"movementLockMs":300,"presence":false}]}]}],
           "result":"BOT_WIN","winnerUserId":"6f1d1d2e-6a51-4c8e-9a52-3c1f5d0b7e11","message":"Blue wins."}}
        """;

    @Test void realisticWorkerReplayDeserializesAndRoundTripsIntoMatchReplayDTO() throws Exception {
        var client=new SimWorkerClient(mapper,new SimpleMeterRegistry(),"http://127.0.0.1:1","secret",Duration.ofSeconds(1),1);
        MatchReplayDTO replay=client.parseResponse(REALISTIC_REPLAY,false).replay();
        client.close();

        assertThat(replay.result()).isEqualTo("BOT_WIN");
        assertThat(replay.winnerUserId()).isEqualTo(UUID.fromString("6f1d1d2e-6a51-4c8e-9a52-3c1f5d0b7e11"));
        assertThat(replay.message()).isEqualTo("Blue wins.");
        assertThat(replay.initialState().bots()).hasSize(2);
        assertThat(replay.initialState().bots().getFirst().abilityCooldowns()).containsEntry(1, 0);
        assertThat(replay.frames()).hasSize(1);
        var frame=replay.frames().getFirst();
        assertThat(frame.elapsedMs()).isEqualTo(100);
        assertThat(frame.bots().getFirst().statusEffects()).hasSize(1);
        assertThat(frame.bots().getFirst().statusEffects().getFirst().effects.getFirst().damageModifier).isEqualTo(0.25);
        assertThat(frame.bots().getFirst().preparingAbility()).isEqualTo(19);
        assertThat(frame.bots().getFirst().teamNumber()).isEqualTo(1);
        assertThat(frame.entities()).hasSize(1);
        assertThat(frame.entities().getFirst().id()).isEqualTo("hunter-7");
        assertThat(frame.entities().getFirst().statusEffects().getFirst().movementLockMs()).isEqualTo(300);

        JsonNode original=mapper.readTree(REALISTIC_REPLAY).path("replay");
        JsonNode serialized=mapper.valueToTree(replay);
        assertContainsAll(original,serialized,"replay");
    }

    /** Every field the worker sent must come back with the same value after a DTO round trip. */
    private static void assertContainsAll(JsonNode expected, JsonNode actual, String path) {
        if (expected.isObject()) {
            assertThat(actual.isObject()).as(path).isTrue();
            expected.properties().forEach(field -> {
                assertThat(actual.has(field.getKey())).as(path + "." + field.getKey()).isTrue();
                assertContainsAll(field.getValue(), actual.get(field.getKey()), path + "." + field.getKey());
            });
        } else if (expected.isArray()) {
            assertThat(actual.size()).as(path + " size").isEqualTo(expected.size());
            for (int index = 0; index < expected.size(); index++) {
                assertContainsAll(expected.get(index), actual.get(index), path + "[" + index + "]");
            }
        } else {
            assertThat(actual).as(path).isEqualTo(expected);
        }
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String json) {
        try {
            var bytes=json.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,bytes.length);
            exchange.getResponseBody().write(bytes);
        } catch (java.io.IOException failure) {
            throw new java.io.UncheckedIOException(failure);
        } finally {
            exchange.close();
        }
    }

    private SimWorkerClient client(HttpServer server,SimpleMeterRegistry metrics,Duration timeout) {
        return new SimWorkerClient(mapper,metrics,"http://127.0.0.1:"+server.getAddress().getPort(),"test-secret",timeout,1);
    }

    @Nested
    class WorkerAdmission {
        private final JsonMapper mapper = new JsonMapper();
        private final DuelSimulationRequest request = new DuelSimulationRequest(UUID.randomUUID(), "duel-v1", 1L,
                new DuelArenaRequest(1200, 1200, 200), List.of());
        private static final String RESPONSE = """
            {"engineVersion":"test","replay":{"initialState":{"bots":[]},"frames":[],
            "result":"DRAW","message":"draw"},"puzzle":{"status":"failed","elapsedMs":1}}
            """;

        private HttpServer blockingWorker(CountDownLatch entered, CountDownLatch release) throws Exception {
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.setExecutor(Executors.newCachedThreadPool());
            server.createContext("/simulate", e -> {
                e.getRequestBody().readAllBytes();
                entered.countDown();
                try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException x) { Thread.currentThread().interrupt(); }
                var bytes = RESPONSE.getBytes(StandardCharsets.UTF_8);
                e.sendResponseHeaders(200, bytes.length);
                e.getResponseBody().write(bytes);
                e.close();
            });
            server.start();
            return server;
        }

        private SimWorkerClient client(HttpServer server, int concurrency) {
            return new SimWorkerClient(mapper, new SimpleMeterRegistry(),
                    "http://127.0.0.1:" + server.getAddress().getPort(), "secret", Duration.ofSeconds(10), concurrency);
        }

        private PuzzleRequest puzzle() {
            return new PuzzleRequest(mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}"),
                    mapper.readTree("[{\"type\":\"hp\"}]"), mapper.readTree("[]"), 30_000, 0);
        }

        @Test
        void ratedRoundIsNotRejectedWhileTwoPuzzleAttemptsHoldTheDefaultPermits() throws Exception {
            var entered = new CountDownLatch(2);
            var release = new CountDownLatch(1);
            var server = blockingWorker(entered, release);
            var pool = Executors.newFixedThreadPool(3);
            try (var client = client(server, 2)) { // default sim.worker.concurrency
                var p1 = pool.submit(() -> client.simulatePuzzle(request, puzzle()));
                var p2 = pool.submit(() -> client.simulatePuzzle(request, puzzle()));
                assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue(); // both permits now held by puzzles

                Future<WorkerResult> rated = pool.submit(() -> client.simulate(request));
                // Correct behaviour: the rated round waits for (or has reserved) capacity instead of
                // failing immediately. Under the bug it completes at once with RejectedExecutionException.
                Throwable early = catchThrowable(() -> rated.get(500, TimeUnit.MILLISECONDS));
                assertThat(early)
                        .as("rated round must not be rejected while puzzle attempts hold worker permits")
                        .isInstanceOf(TimeoutException.class);

                release.countDown();
                assertThat(rated.get(5, TimeUnit.SECONDS).replay().result()).isEqualTo("DRAW");
                p1.get(5, TimeUnit.SECONDS);
                p2.get(5, TimeUnit.SECONDS);
            } finally {
                release.countDown();
                pool.shutdownNow();
                server.stop(0);
            }
        }

        @Test
        void puzzleAttemptRejectedByBusyWorkerIsARateLimitNotA500() throws Exception {
            var entered = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            var server = blockingWorker(entered, release);
            var pool = Executors.newSingleThreadExecutor();
            try (var client = client(server, 1)) {
                var ratedInFlight = pool.submit(() -> client.simulate(request));
                assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue(); // worker permit held by a rated round

                PuzzleService puzzleService = mock(PuzzleService.class);
                when(puzzleService.prepareAttempt(any(Long.class), any())).thenReturn(
                        new PuzzleService.PuzzleAttemptDefinition(7L, 30_000, 0,
                                mapper.readTree("[{\"type\":\"hp\"}]"), mapper.readTree("[]"),
                                mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}"), List.of()));
                @SuppressWarnings("unchecked")
                TokenBucketRateLimiter<UUID> limiter = mock(TokenBucketRateLimiter.class);
                var service = new PuzzleAttemptService(puzzleService, client, mock(CurrentUserService.class),
                        limiter, new PuzzleSimulationAdmissionControl(2));

                // Puzzle admission (2 permits) admits the attempt, but the worker pool rejects it;
                // GlobalExceptionHandler maps only RateLimitExceededException to 429, anything else to 500.
                assertThatThrownBy(() -> service.attempt(7L, null))
                        .isInstanceOf(RateLimitExceededException.class);

                release.countDown();
                ratedInFlight.get(5, TimeUnit.SECONDS);
            } finally {
                release.countDown();
                pool.shutdownNow();
                server.stop(0);
            }
        }
    }

    @Nested
    class ResponseValidation {
        private final SimWorkerClient client = new SimWorkerClient(new JsonMapper(), new SimpleMeterRegistry(),
                "http://127.0.0.1:1", "secret", Duration.ofSeconds(1), 1);

        @Test void drawCarryingAWinnerIsRejected() {
            String drawWithWinner = "{\"engineVersion\":\"t\",\"replay\":{\"frames\":[],\"result\":\"DRAW\","
                    + "\"winnerUserId\":\"11111111-1111-1111-1111-111111111111\"}}";
            assertThatThrownBy(() -> client.parseResponse(drawWithWinner, false))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test void botWinWithoutWinnerIsRejected() {
            String botWinNoWinner = "{\"engineVersion\":\"t\",\"replay\":{\"frames\":[],\"result\":\"BOT_WIN\"}}";
            assertThatThrownBy(() -> client.parseResponse(botWinNoWinner, false))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test void missingFramesAreRejected() {
            String noFrames = "{\"engineVersion\":\"t\",\"replay\":{\"result\":\"DRAW\"}}";
            assertThatThrownBy(() -> client.parseResponse(noFrames, false))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Nested
    class EntityStatusRoundTrip {
        private final JsonMapper mapper = new JsonMapper();

        // Entity status exactly as AbilityEntitySystem.applySummonStatus emits it for a whileInside silence.
        private static final String WORKER_REPLAY = """
            {"engineVersion":"t","replay":{"initialState":{"bots":[]},
             "frames":[{"elapsedMs":100,"entities":[
               {"id":"zone-1","type":"nullZone","x":1.0,"y":2.0,"size":10,
                "statusEffects":[{"type":"silence","mode":"presence","remainingMs":0,"intervalMs":0,
                  "amount":0.0,"movementLockMs":0,
                  "effects":[{"type":"silence","mode":"constant"}]}]}]}],
             "result":"DRAW","message":"The fight ended in a draw."}}
            """;

        @Test void entityStatusKeepsModeAndEffectsThroughDtoRoundTrip() throws Exception {
            var client = new SimWorkerClient(mapper, new SimpleMeterRegistry(), "http://127.0.0.1:1", "secret",
                    Duration.ofSeconds(1), 1);
            MatchReplayDTO replay = client.parseResponse(WORKER_REPLAY, false).replay();
            client.close();

            JsonNode status = mapper.valueToTree(replay).path("frames").get(0).path("entities").get(0)
                    .path("statusEffects").get(0);
            assertThat(status.has("mode")).as("mode survives: " + status).isTrue();
            assertThat(status.has("effects")).as("effects survive: " + status).isTrue();
            assertThat(status.path("presence").asBoolean(false)).as("presence reflects mode: " + status).isTrue();
        }
    }
}
