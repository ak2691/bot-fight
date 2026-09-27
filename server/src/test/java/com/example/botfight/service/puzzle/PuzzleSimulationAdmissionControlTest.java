package com.example.botfight.service.puzzle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.botfight.service.limits.RateLimitExceededException;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class PuzzleSimulationAdmissionControlTest {

    @Test
    void concurrentRequestGetsRetryableRejectionAndPermitReturnsWhenSimulationEnds() throws Exception {
        PuzzleSimulationAdmissionControl admission = new PuzzleSimulationAdmissionControl(1);
        CountDownLatch requestStarted = new CountDownLatch(1);
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try (PuzzleSimulationAdmissionControl.Lease active = admission.acquire(null)) {
            Future<RateLimitExceededException> rejected = executor.submit(() -> {
                requestStarted.countDown();
                try {
                    admission.acquire(UUID.randomUUID());
                    throw new AssertionError("request should have been rejected at capacity");
                } catch (RateLimitExceededException expected) {
                    return expected;
                }
            });

            assertThat(requestStarted.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(rejected.get(2, TimeUnit.SECONDS).getRetryAfter())
                    .isEqualTo(Duration.ofSeconds(1));
        } finally {
            executor.shutdownNow();
        }

        try (PuzzleSimulationAdmissionControl.Lease available = admission.acquire(UUID.randomUUID())) {
            assertThat(available).isNotNull();
        }
    }

    @Test
    void preventsTwoConcurrentAttemptsForTheSameAuthenticatedUser() {
        PuzzleSimulationAdmissionControl admission = new PuzzleSimulationAdmissionControl(2);
        UUID userId = UUID.randomUUID();

        try (PuzzleSimulationAdmissionControl.Lease active = admission.acquire(userId)) {
            assertThatThrownBy(() -> admission.acquire(userId))
                    .isInstanceOf(RateLimitExceededException.class)
                    .hasMessage(RateLimitExceededException.GENERIC_MESSAGE);

            try (PuzzleSimulationAdmissionControl.Lease otherUser = admission.acquire(UUID.randomUUID())) {
                assertThat(otherUser).isNotNull();
            }
        }
    }
}
