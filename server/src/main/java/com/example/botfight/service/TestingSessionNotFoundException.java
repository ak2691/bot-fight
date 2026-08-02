package com.example.botfight.service;

import java.util.UUID;

public class TestingSessionNotFoundException extends RuntimeException {

    public TestingSessionNotFoundException(UUID testingSessionId) {
        super("Testing session not found: " + testingSessionId);
    }
}
