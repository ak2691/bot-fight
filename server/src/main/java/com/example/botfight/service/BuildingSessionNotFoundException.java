package com.example.botfight.service;

import java.util.UUID;

public class BuildingSessionNotFoundException extends RuntimeException {

    public BuildingSessionNotFoundException(UUID buildingSessionId) {
        super("Building session not found: " + buildingSessionId);
    }
}
