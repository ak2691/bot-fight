package com.example.botfight.service;

import java.util.UUID;

public class TrainingSessionNotFoundException extends RuntimeException {

    public TrainingSessionNotFoundException(UUID trainingSessionId) {
        super("Training session not found: " + trainingSessionId);
    }
}
