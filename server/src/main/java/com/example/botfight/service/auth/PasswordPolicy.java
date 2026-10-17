package com.example.botfight.service.auth;

import java.nio.charset.StandardCharsets;

public final class PasswordPolicy {

    public static final int MIN_LENGTH = 8;
    public static final int MAX_UTF8_BYTES = 72;

    private PasswordPolicy() {
    }

    public static void validateForRegistration(String password) {
        if (password == null || password.isEmpty()) {
            throw new AuthException("password is required");
        }
        if (password.length() < MIN_LENGTH) {
            throw new AuthException("password must be at least 8 characters");
        }
        if (password.getBytes(StandardCharsets.UTF_8).length > MAX_UTF8_BYTES) {
            throw new AuthException("password must be at most 72 UTF-8 bytes");
        }
        if (containsWhitespace(password)) {
            throw new AuthException("password cannot contain spaces");
        }
    }

    public static void requireForLogin(String password) {
        if (password == null || password.isEmpty()) {
            throw new AuthException("password is required");
        }
        if (password.getBytes(StandardCharsets.UTF_8).length > MAX_UTF8_BYTES) {
            throw new AuthException("invalid email or password");
        }
        if (containsWhitespace(password)) {
            throw new AuthException("password cannot contain spaces");
        }
    }

    private static boolean containsWhitespace(String value) {
        return value.codePoints().anyMatch(codePoint ->
                Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint));
    }
}
