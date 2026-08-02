package com.example.botfight.service;

import java.util.regex.Pattern;

public final class UsernamePolicy {

    public static final int MIN_LENGTH = 3;
    public static final int MAX_LENGTH = 20;

    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[A-Za-z0-9_-]+$");

    private UsernamePolicy() {
    }

    public static String clean(String username) {
        return username == null ? null : username.trim();
    }

    public static void validate(String username) {
        if (username == null || username.isEmpty()) {
            throw new AuthException("username is required");
        }
        if (username.length() < MIN_LENGTH || username.length() > MAX_LENGTH) {
            throw new AuthException("username must be between 3 and 20 characters");
        }
        if (!USERNAME_PATTERN.matcher(username).matches()) {
            throw new AuthException("username may only contain letters, numbers, underscores, and hyphens");
        }
    }

    public static boolean isValid(String username) {
        return username != null
                && username.length() >= MIN_LENGTH
                && username.length() <= MAX_LENGTH
                && USERNAME_PATTERN.matcher(username).matches();
    }
}
