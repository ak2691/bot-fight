package com.example.botfight.service;

import java.util.List;

public record BotSubmissionValidationResult(List<String> errors) {

    public boolean isValid() {
        return errors.isEmpty();
    }
}
