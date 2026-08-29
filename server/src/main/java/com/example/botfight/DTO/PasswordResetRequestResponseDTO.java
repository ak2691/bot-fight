package com.example.botfight.DTO;

public record PasswordResetRequestResponseDTO(String message) {

    public static PasswordResetRequestResponseDTO generic() {
        return new PasswordResetRequestResponseDTO(
                "If an email/password account exists for that address, a password reset code has been sent.");
    }
}
