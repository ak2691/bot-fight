package com.example.botfight.controller;

import java.time.Clock;
import java.time.Instant;
import java.util.Map;
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
    public Map<String, Instant> now() {
        return Map.of("serverNow", Instant.now(clock));
    }
}
