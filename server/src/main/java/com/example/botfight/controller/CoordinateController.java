package com.example.botfight.controller;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.botfight.DTO.ArenaPayloadDTO;
import com.example.botfight.DTO.CoordinateDTO;
import com.example.botfight.DTO.ShapeObjectDTO;

@RestController
@RequestMapping("/api")
// Testing github actions new comment check
public class CoordinateController {

    private static final Logger log = LoggerFactory.getLogger(CoordinateController.class);
    private static final int MAX_OBJECTS = 100;
    private static final int MAX_ABSOLUTE_COORDINATE = 10_000;
    private static final int MAX_REWARD_ABSOLUTE_VALUE = 10_000;
    private static final int MAX_ID_LENGTH = 80;
    private static final int MAX_TYPE_LENGTH = 30;
    private static final Pattern SAFE_TOKEN = Pattern.compile("^[A-Za-z0-9_-]+$");

    @PostMapping("/coordinates")
    public ResponseEntity<String> receiveCoordinates(@RequestBody ArenaPayloadDTO payload) {
        List<String> errors = validatePayload(payload);
        if (!errors.isEmpty()) {
            return ResponseEntity.badRequest().body("Invalid arena payload: " + String.join("; ", errors));
        }

        // 1. Log the Main Player Model
        log.info("--- NEW ARENA PAYLOAD RECEIVED ---");
        log.info("Player Model -> X: {}, Y: {}",
                payload.getPlayerModel().getX(),
                payload.getPlayerModel().getY());

        // 2. Log the Environment Objects
        log.info("Environment Objects count: {}", payload.getObjects().size());
        log.info("Reward score: {}", payload.getReward());
        payload.getObjects().forEach(obj -> {
            log.info("   Obj [{}] - Type: {}, X: {}, Y: {}, Size: {}, Rotation: {}°",
                    obj.getId().substring(Math.max(0, obj.getId().length() - 4)), // Just print last 4 chars of ID
                    obj.getType(),
                    obj.getX(),
                    obj.getY(),
                    obj.getSize(),
                    obj.getRotation());
        });

        // 3. Return success to React
        return ResponseEntity
                .ok("Successfully received environment state with " + payload.getObjects().size() + " objects.");
    }

    private List<String> validatePayload(ArenaPayloadDTO payload) {
        List<String> errors = new ArrayList<>();
        if (payload == null) {
            errors.add("payload is required");
            return errors;
        }

        validateCoordinate(errors, payload.getPlayerModel(), "playerModel");
        if (payload.getReward() == null) {
            errors.add("reward is required");
        } else if (isOutsideRange(payload.getReward(), MAX_REWARD_ABSOLUTE_VALUE)) {
            errors.add("reward is out of range");
        }

        if (payload.getObjects() == null) {
            errors.add("objects is required");
            return errors;
        }
        if (payload.getObjects().size() > MAX_OBJECTS) {
            errors.add("objects cannot exceed " + MAX_OBJECTS);
        }

        for (int i = 0; i < payload.getObjects().size(); i++) {
            ShapeObjectDTO object = payload.getObjects().get(i);
            String prefix = "objects[" + i + "]";
            if (object == null) {
                errors.add(prefix + " is required");
                continue;
            }

            validateToken(errors, object.getId(), prefix + ".id", MAX_ID_LENGTH);
            validateToken(errors, object.getType(), prefix + ".type", MAX_TYPE_LENGTH);
            validateCoordinate(errors, new CoordinateDTO(object.getX(), object.getY()), prefix);
            if (object.getSize() <= 0 || object.getSize() > 1_000) {
                errors.add(prefix + ".size is out of range");
            }
            if (object.getRotation() < 0 || object.getRotation() >= 360) {
                errors.add(prefix + ".rotation must be between 0 and 359");
            }
        }

        return errors;
    }

    private void validateCoordinate(List<String> errors, CoordinateDTO coordinate, String field) {
        if (coordinate == null) {
            errors.add(field + " is required");
            return;
        }

        if (isOutsideRange(coordinate.getX(), MAX_ABSOLUTE_COORDINATE)) {
            errors.add(field + ".x is out of range");
        }
        if (isOutsideRange(coordinate.getY(), MAX_ABSOLUTE_COORDINATE)) {
            errors.add(field + ".y is out of range");
        }
    }

    private void validateToken(List<String> errors, String value, String field, int maxLength) {
        if (value == null || value.isBlank()) {
            errors.add(field + " is required");
            return;
        }
        if (value.length() > maxLength) {
            errors.add(field + " is too long");
        }
        if (!SAFE_TOKEN.matcher(value).matches()) {
            errors.add(field + " contains unsupported characters");
        }
    }

    private boolean isOutsideRange(int value, int absoluteLimit) {
        return value < -absoluteLimit || value > absoluteLimit;
    }
}
