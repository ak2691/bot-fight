package com.example.botfight.DTO;

import java.util.UUID;

public class AuthUserDTO {

    private boolean authenticated;
    private UUID id;
    private String email;
    private String username;
    private boolean admin;
    private boolean hasPassword;

    public boolean isAuthenticated() {
        return authenticated;
    }

    public void setAuthenticated(boolean authenticated) {
        this.authenticated = authenticated;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public boolean isAdmin() {
        return admin;
    }

    public void setAdmin(boolean admin) {
        this.admin = admin;
    }

    public boolean isHasPassword() {
        return hasPassword;
    }

    public void setHasPassword(boolean hasPassword) {
        this.hasPassword = hasPassword;
    }

    public static AuthUserDTO guest() {
        AuthUserDTO user = new AuthUserDTO();
        user.setAuthenticated(false);
        user.setUsername("guest");
        return user;
    }
}
