package com.example.botfight.DTO.auth;

/** Generic acknowledgements for public requests whose processing depends on account state. */
public record AuthRequestResponseDTO(String message) {

    public static AuthRequestResponseDTO registration() {
        return new AuthRequestResponseDTO(
                "If this address can be used for registration, we'll send an email with next steps.");
    }

    public static AuthRequestResponseDTO verificationResend() {
        return new AuthRequestResponseDTO(
                "If an account needs email verification, a verification code has been sent.");
    }
}
