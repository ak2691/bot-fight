package com.example.botfight.controller;

import java.time.Clock;
import java.time.Instant;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/time")
public class TimeController {

    private final Clock clock;

    public TimeController(Clock clock) {
        this.clock = clock;
    }

    @GetMapping
    public TimeSample now() {
        Instant serverReceiveTime = Instant.now(clock);
        Instant serverTransmitTime = Instant.now(clock);
        return new TimeSample(serverReceiveTime, serverTransmitTime);
    }

    public record TimeSample(
            Instant serverReceiveTime,
            Instant serverTransmitTime) {
    }
}
