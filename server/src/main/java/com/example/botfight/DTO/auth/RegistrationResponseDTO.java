package com.example.botfight.DTO.auth;

public class RegistrationResponseDTO {

    private boolean verificationRequired;
    private String email;

    public RegistrationResponseDTO() {
    }

    public RegistrationResponseDTO(String email) {
        this.verificationRequired = true;
        this.email = email;
    }

    public boolean isVerificationRequired() {
        return verificationRequired;
    }

    public void setVerificationRequired(boolean verificationRequired) {
        this.verificationRequired = verificationRequired;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
