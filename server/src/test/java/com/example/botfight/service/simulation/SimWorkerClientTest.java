package com.example.botfight.service.simulation;
import static org.assertj.core.api.Assertions.*;
import com.example.botfight.service.simulation.SimulationRequest.*;
import com.sun.net.httpserver.HttpServer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
class SimWorkerClientTest {
    private final JsonMapper mapper=new JsonMapper();
    private final DuelSimulationRequest request=new DuelSimulationRequest(UUID.randomUUID(),"duel-v2",Long.MAX_VALUE,
            new DuelArenaRequest(1200,1200,200),List.of());
    private String response() { return """
        {"result":{"engineVersion":"test","outcome":"DRAW","endReason":"KO","winnerTeam":null,
        "segmentEndMs":200,"teamHp":[],"endState":[]},"replay":{"initialState":{"shapes":[]},"batches":[
        {"sequence":1,"endMs":200,"terminal":true,"frames":[{"elapsedMs":200,"shapes":[]}]}]}}
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
            var pending=pool.submit(()->client.simulate(request,null));
            assertThat(entered.await(2,TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(()->client.simulate(request,null)).isInstanceOf(RejectedExecutionException.class);
            assertThat(secret.get()).isEqualTo("test-secret");
            var json=mapper.readTree(body.get());
            assertThat(json.path("seed").asText()).isEqualTo(Long.toString(Long.MAX_VALUE));
            assertThat(json.has("diagnostics")).isFalse();
            release.countDown();assertThat(pending.get(3,TimeUnit.SECONDS).result().engineVersion()).isEqualTo("test");
            assertThat(metrics.get("sim.worker.authority.matches").counter().count()).isEqualTo(1);
        } finally {release.countDown();pool.shutdownNow();server.stop(0);}
    }
    @Test void workerSecretAndPositiveBoundsAreRequired() {
        var metrics=new SimpleMeterRegistry();
        assertThatThrownBy(()->new SimWorkerClient(mapper,metrics,"http://127.0.0.1:1","",Duration.ofSeconds(1),1)).hasMessageContaining("secret");
        assertThatThrownBy(()->new SimWorkerClient(mapper,metrics,"http://127.0.0.1:1","secret",Duration.ZERO,1)).hasMessageContaining("positive");
        assertThatThrownBy(()->new SimWorkerClient(mapper,metrics,"http://127.0.0.1:1","secret",Duration.ofSeconds(1),0)).hasMessageContaining("positive");
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
                    assertThatThrownBy(()->client.simulate(request,null)).isInstanceOf(RuntimeException.class);
                    assertThatThrownBy(()->client.simulate(request,null)).isNotInstanceOf(RejectedExecutionException.class);
                    assertThat(metrics.get("sim.worker.authority.failures").counter().count()).isEqualTo(2);
                }
            }
        } finally {server.stop(0);}
    }
    private SimWorkerClient client(HttpServer server,SimpleMeterRegistry metrics,Duration timeout) {
        return new SimWorkerClient(mapper,metrics,"http://127.0.0.1:"+server.getAddress().getPort(),"test-secret",timeout,1);
    }

    @Test
    void validationTransportsPuzzleOptionsAndReturnsWorkerErrors() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var body = new AtomicReference<String>();
        var secret = new AtomicReference<String>();
        server.createContext("/validate", exchange -> {
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            secret.set(exchange.getRequestHeaders().getFirst("X-Sim-Worker-Secret"));
            var bytes = "{\"errors\":[\"Puzzle action budget exceeded.\"]}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try (var client = client(server, new SimpleMeterRegistry(), Duration.ofSeconds(2))) {
            var brain = mapper.readTree("{\"version\":\"bot-logic-tree-v2\",\"roots\":[]}");
            var constraints = Map.<String, Object>of("maxActionNodes", 3, "reservePuzzleNamespace", true);
            assertThat(client.validateBrain(brain, false, constraints)).containsExactly("Puzzle action budget exceeded.");
            var requestBody = mapper.readTree(body.get());
            assertThat(requestBody.path("brain")).isEqualTo(brain);
            assertThat(requestBody.path("puzzleConstraints").path("maxActionNodes").asInt()).isEqualTo(3);
            assertThat(requestBody.path("puzzleConstraints").path("reservePuzzleNamespace").asBoolean()).isTrue();
            assertThat(requestBody.has("puzzleRules")).isFalse();
            assertThat(secret.get()).isEqualTo("test-secret");
            client.validateBrain(brain, true);
            assertThat(mapper.readTree(body.get()).path("puzzleRules").asBoolean()).isTrue();
            assertThat(mapper.readTree(body.get()).has("puzzleConstraints")).isFalse();
        } finally {
            server.stop(0);
        }
    }
}
