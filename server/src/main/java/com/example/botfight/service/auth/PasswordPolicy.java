package com.example.botfight.service.auth;

public final class PasswordPolicy {

    public static final int MIN_LENGTH = 8;
    public static final int MAX_LENGTH = 128;

    private PasswordPolicy() {
    }

    public static void validateForRegistration(String password) {
        if (password == null || password.isEmpty()) {
            throw new AuthException("password is required");
        }
        if (password.length() < MIN_LENGTH || password.length() > MAX_LENGTH) {
            throw new AuthException("password must be between 8 and 128 characters");
        }
        if (containsWhitespace(password)) {
            throw new AuthException("password cannot contain spaces");
        }
    }

    public static void requireForLogin(String password) {
        if (password == null || password.isEmpty()) {
            throw new AuthException("password is required");
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
