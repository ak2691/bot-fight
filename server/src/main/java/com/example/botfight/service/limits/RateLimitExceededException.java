package com.example.botfight.service.limits;

import java.time.Duration;

public class RateLimitExceededException extends RuntimeException {

    public static final String GENERIC_MESSAGE = "Too many requests, please wait.";

    private final Duration retryAfter;

    public RateLimitExceededException(Duration retryAfter) {
        super(GENERIC_MESSAGE);
        this.retryAfter = retryAfter == null || retryAfter.isNegative() || retryAfter.isZero()
                ? Duration.ofSeconds(1)
                : retryAfter;
    }

    public static RateLimitExceededException tooManyRequests(Duration retryAfter) {
        return new RateLimitExceededException(retryAfter);
    }

    public Duration getRetryAfter() {
        return retryAfter;
    }
}
