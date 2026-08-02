package com.example.botfight.controller;

import com.example.botfight.DTO.AuthRequestDTO;
import com.example.botfight.DTO.AuthUserDTO;
import com.example.botfight.DTO.GoogleAuthStatusDTO;
import com.example.botfight.DTO.GoogleLinkRequestDTO;
import com.example.botfight.DTO.UsernameRequestDTO;
import com.example.botfight.service.AuthException;
import com.example.botfight.service.AuthService;
import com.example.botfight.service.GoogleAuthService;
import java.io.IOException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final GoogleAuthService googleAuthService;

    public AuthController(AuthService authService, GoogleAuthService googleAuthService) {
        this.authService = authService;
        this.googleAuthService = googleAuthService;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthUserDTO> register(
            @RequestBody AuthRequestDTO request,
            HttpServletRequest httpRequest) {
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(request, httpRequest));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthUserDTO> login(
            @RequestBody AuthRequestDTO request,
            HttpServletRequest httpRequest) {
        return ResponseEntity.ok(authService.login(request, httpRequest));
    }

    @PostMapping("/google/link-existing")
    public ResponseEntity<AuthUserDTO> linkExistingGoogleAccount(
            @RequestBody GoogleLinkRequestDTO request,
            HttpServletRequest httpRequest) {
        return ResponseEntity.ok(googleAuthService.completePendingLink(request, httpRequest));
    }

    @PostMapping("/google/username")
    public ResponseEntity<AuthUserDTO> completeGoogleUsername(
            @RequestBody UsernameRequestDTO request,
            HttpServletRequest httpRequest) {
        return ResponseEntity.ok(googleAuthService.completePendingUsername(request, httpRequest));
    }

    @GetMapping("/google/link")
    public void beginGoogleLink(
            Authentication authentication,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) throws IOException {
        googleAuthService.beginLink(authentication, httpRequest);
        httpResponse.sendRedirect("/oauth2/authorization/google");
    }

    @GetMapping("/google/status")
    public GoogleAuthStatusDTO googleStatus(Authentication authentication) {
        return new GoogleAuthStatusDTO(googleAuthService.isGoogleLinked(authentication));
    }

    @PostMapping("/logout")
    public ResponseEntity<AuthUserDTO> logout(
            HttpServletRequest request,
            HttpServletResponse response) {
        SecurityContextHolder.clearContext();
        if (request.getSession(false) != null) {
            request.getSession(false).invalidate();
        }
        return ResponseEntity.ok(AuthUserDTO.guest());
    }

    @GetMapping("/me")
    public ResponseEntity<AuthUserDTO> me(Authentication authentication) {
        return ResponseEntity.ok(authService.currentUser(authentication));
    }

    @GetMapping("/csrf")
    public ResponseEntity<Map<String, String>> csrf(CsrfToken csrfToken) {
        return ResponseEntity.ok(Map.of(
                "headerName", csrfToken.getHeaderName(),
                "token", csrfToken.getToken()));
    }

    @ExceptionHandler(AuthException.class)
    public ResponseEntity<Map<String, String>> handleAuthException(AuthException ex) {
        return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
    }
}
