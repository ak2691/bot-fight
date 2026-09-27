package com.example.botfight.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.auth.AuthRequestDTO;
import com.example.botfight.DTO.auth.AuthRequestResponseDTO;
import com.example.botfight.DTO.auth.AuthUserDTO;
import com.example.botfight.DTO.auth.EmailVerificationRequestDTO;
import com.example.botfight.DTO.auth.PasswordChangeRequestDTO;
import com.example.botfight.DTO.auth.PasswordResetPasswordRequestDTO;
import com.example.botfight.DTO.auth.PasswordResetRequestDTO;
import com.example.botfight.DTO.auth.PasswordResetRequestResponseDTO;
import com.example.botfight.DTO.auth.RegistrationResponseDTO;
import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.AuthService;
import com.example.botfight.service.auth.GoogleAuthService;
import com.example.botfight.service.auth.PasswordResetService;
import com.example.botfight.service.limits.TokenBucketRateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;

class AuthControllerTest {

    @Test
    void registrationAcknowledgementIsIdenticalForNewAndAlreadyRegisteredEmails() {
        AuthService authService = mock(AuthService.class);
        List<Runnable> queuedWork = new ArrayList<>();
        AuthController controller = controller(authService, mock(PasswordResetService.class), queuedWork::add);
        AuthRequestDTO newEmailRequest = registrationRequest("new@example.test", "new-pilot");
        AuthRequestDTO duplicateEmailRequest = registrationRequest("existing@example.test", "existing-pilot");

        doThrow(new AuthException("email is already registered"))
                .when(authService).register(org.mockito.ArgumentMatchers.argThat(
                        candidate -> "existing@example.test".equals(candidate.getEmail())));

        var newEmail = controller.register(newEmailRequest, mock(HttpServletRequest.class));
        var duplicateEmail = controller.register(duplicateEmailRequest, mock(HttpServletRequest.class));

        assertThat(newEmail).isEqualTo(duplicateEmail);
        assertThat(newEmail.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(newEmail.getBody()).isEqualTo(AuthRequestResponseDTO.registration());
        assertThat(queuedWork).hasSize(2);
        verify(authService).validateRegistration(newEmailRequest);
        verify(authService).validateRegistration(duplicateEmailRequest);
        verify(authService, never()).register(any(AuthRequestDTO.class));

        queuedWork.forEach(Runnable::run);

        verify(authService).register(org.mockito.ArgumentMatchers.argThat(
                candidate -> "new@example.test".equals(candidate.getEmail())));
        verify(authService).register(org.mockito.ArgumentMatchers.argThat(
                candidate -> "existing@example.test".equals(candidate.getEmail())));
    }

    @Test
    void registrationStillRejectsValidationFailuresBeforeQueueingAccountWork() {
        AuthService authService = mock(AuthService.class);
        List<Runnable> queuedWork = new ArrayList<>();
        AuthController controller = controller(authService, mock(PasswordResetService.class), queuedWork::add);
        AuthRequestDTO request = registrationRequest("pilot@example.test", "taken-pilot");
        doThrow(new AuthException("username is already taken"))
                .when(authService).validateRegistration(request);

        org.assertj.core.api.Assertions.assertThatThrownBy(
                () -> controller.register(request, mock(HttpServletRequest.class)))
                .isInstanceOf(AuthException.class)
                .hasMessage("username is already taken");

        assertThat(queuedWork).isEmpty();
        verify(authService, never()).register(any(AuthRequestDTO.class));
    }

    @Test
    void sessionBootstrapDoesNotUseTheAuthenticatedGetRateLimiter() {
        AuthService authService = mock(AuthService.class);
        GoogleAuthService googleAuthService = mock(GoogleAuthService.class);
        Authentication authentication = mock(Authentication.class);
        AuthUserDTO currentUser = new AuthUserDTO();
        currentUser.setAuthenticated(true);
        when(authService.currentUser(authentication)).thenReturn(currentUser);

        Clock fixedClock = Clock.fixed(Instant.EPOCH, ZoneOffset.UTC);
        AuthController controller = new AuthController(
                authService,
                googleAuthService,
                new TokenBucketRateLimiter<>(fixedClock, 30, Duration.ofSeconds(1)),
                new TokenBucketRateLimiter<>(fixedClock, 5, Duration.ofSeconds(30)),
                new TokenBucketRateLimiter<>(fixedClock, 1, Duration.ofSeconds(1)));

        HttpServletRequest request = mock(HttpServletRequest.class);
        assertThat(controller.me(authentication, request).getBody()).isSameAs(currentUser);
        assertThat(controller.me(authentication, request).getBody()).isSameAs(currentUser);
    }

    @Test
    void invalidSessionCookieReturnsUnauthorizedButAnonymousBootstrapRemainsAvailable() {
        AuthService authService = mock(AuthService.class);
        GoogleAuthService googleAuthService = mock(GoogleAuthService.class);
        Authentication authentication = mock(Authentication.class);
        when(authService.currentUser(authentication)).thenReturn(AuthUserDTO.guest());

        Clock fixedClock = Clock.fixed(Instant.EPOCH, ZoneOffset.UTC);
        AuthController controller = new AuthController(
                authService,
                googleAuthService,
                new TokenBucketRateLimiter<>(fixedClock, 30, Duration.ofSeconds(1)),
                new TokenBucketRateLimiter<>(fixedClock, 5, Duration.ofSeconds(30)),
                new TokenBucketRateLimiter<>(fixedClock, 1, Duration.ofSeconds(1)));

        HttpServletRequest staleRequest = mock(HttpServletRequest.class);
        when(staleRequest.isRequestedSessionIdFromCookie()).thenReturn(true);
        when(staleRequest.getRequestedSessionId()).thenReturn("stale-session");
        when(staleRequest.isRequestedSessionIdValid()).thenReturn(false);

        assertThat(controller.me(authentication, staleRequest).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);

        HttpServletRequest freshRequest = mock(HttpServletRequest.class);
        assertThat(controller.me(authentication, freshRequest).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    void resendVerificationAcknowledgementIsSameForUnknownVerifiedAndPendingAccounts() {
        AuthService authService = mock(AuthService.class);
        List<Runnable> queuedWork = new ArrayList<>();
        AuthController controller = controller(authService, mock(PasswordResetService.class), queuedWork::add);

        when(authService.resendVerification("unknown@example.test"))
                .thenThrow(new AuthException("verification code could not be sent"));
        when(authService.resendVerification("verified@example.test"))
                .thenThrow(new AuthException("email is already verified; please log in"));
        when(authService.resendVerification("pending@example.test"))
                .thenReturn(new RegistrationResponseDTO("pending@example.test"));

        var unknown = controller.resendVerification(resendRequest("unknown@example.test"), mock(HttpServletRequest.class));
        var verified = controller.resendVerification(resendRequest("verified@example.test"), mock(HttpServletRequest.class));
        var pending = controller.resendVerification(resendRequest("pending@example.test"), mock(HttpServletRequest.class));

        assertThat(unknown).isEqualTo(verified).isEqualTo(pending);
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(unknown.getBody()).isEqualTo(AuthRequestResponseDTO.verificationResend());
        assertThat(queuedWork).hasSize(3);
        verify(authService, never()).resendVerification(anyString());

        queuedWork.forEach(Runnable::run);

        verify(authService).resendVerification("unknown@example.test");
        verify(authService).resendVerification("verified@example.test");
        verify(authService).resendVerification("pending@example.test");
    }

    @Test
    void passwordResetAcknowledgementStaysGenericForUnknownAndDeliveryFailure() {
        AuthService authService = mock(AuthService.class);
        PasswordResetService passwordResetService = mock(PasswordResetService.class);
        List<Runnable> queuedWork = new ArrayList<>();
        AuthController controller = controller(authService, passwordResetService, queuedWork::add);

        doNothing().when(passwordResetService).requestPasswordReset("unknown@example.test");
        doNothing().when(passwordResetService).requestPasswordReset("existing@example.test");
        doThrow(new AuthException("password reset email could not be sent; try again later"))
                .when(passwordResetService).requestPasswordReset("mail-failure@example.test");

        var unknown = controller.requestPasswordReset(
                passwordResetRequest("unknown@example.test"), mock(HttpServletRequest.class));
        var existing = controller.requestPasswordReset(
                passwordResetRequest("existing@example.test"), mock(HttpServletRequest.class));
        var mailFailure = controller.requestPasswordReset(
                passwordResetRequest("mail-failure@example.test"), mock(HttpServletRequest.class));

        assertThat(unknown).isEqualTo(existing).isEqualTo(mailFailure);
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(unknown.getBody()).isEqualTo(PasswordResetRequestResponseDTO.generic());
        assertThat(queuedWork).hasSize(3);

        queuedWork.forEach(Runnable::run);

        verify(passwordResetService).requestPasswordReset("unknown@example.test");
        verify(passwordResetService).requestPasswordReset("existing@example.test");
        verify(passwordResetService).requestPasswordReset("mail-failure@example.test");
    }

    @Test
    void queueSaturationKeepsTheSameGenericResendAndResetAcknowledgements() {
        AuthController controller = controller(
                mock(AuthService.class),
                mock(PasswordResetService.class),
                task -> { throw new TaskRejectedException("queue full"); });

        var resend = controller.resendVerification(
                resendRequest("pilot@example.test"), mock(HttpServletRequest.class));
        var reset = controller.requestPasswordReset(
                passwordResetRequest("pilot@example.test"), mock(HttpServletRequest.class));

        assertThat(resend.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(resend.getBody()).isEqualTo(AuthRequestResponseDTO.verificationResend());
        assertThat(reset.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(reset.getBody()).isEqualTo(PasswordResetRequestResponseDTO.generic());
    }

    @Test
    void passwordChangeRotatesTheCurrentSessionIdAfterSuccess() {
        AuthService authService = mock(AuthService.class);
        AuthUserDTO updatedUser = new AuthUserDTO();
        when(authService.changePassword(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(updatedUser);
        AuthController controller = controller(
                authService,
                mock(PasswordResetService.class),
                Runnable::run);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getSession(false)).thenReturn(mock(HttpSession.class));

        var response = controller.changePassword(
                mock(Authentication.class), new PasswordChangeRequestDTO(), request);

        assertThat(response.getBody()).isSameAs(updatedUser);
        verify(request).changeSessionId();
    }

    @Test
    void successfulPasswordResetInvalidatesItsSession() {
        PasswordResetService passwordResetService = mock(PasswordResetService.class);
        AuthController controller = controller(
                mock(AuthService.class),
                passwordResetService,
                Runnable::run);
        HttpServletRequest request = mock(HttpServletRequest.class);
        HttpSession session = mock(HttpSession.class);
        when(request.getSession(false)).thenReturn(session);

        var response = controller.resetPassword(new PasswordResetPasswordRequestDTO(), request);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(passwordResetService).resetPassword(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.same(request));
        verify(session).invalidate();
    }

    private AuthController controller(
            AuthService authService,
            PasswordResetService passwordResetService,
            TaskExecutor taskExecutor) {
        GoogleAuthService googleAuthService = mock(GoogleAuthService.class);
        Clock fixedClock = Clock.fixed(Instant.EPOCH, ZoneOffset.UTC);
        return new AuthController(
                authService,
                googleAuthService,
                new TokenBucketRateLimiter<>(fixedClock, 30, Duration.ofSeconds(1)),
                new TokenBucketRateLimiter<>(fixedClock, 5, Duration.ofSeconds(30)),
                new TokenBucketRateLimiter<>(fixedClock, 1, Duration.ofSeconds(1)),
                passwordResetService,
                taskExecutor);
    }

    private EmailVerificationRequestDTO resendRequest(String email) {
        EmailVerificationRequestDTO request = new EmailVerificationRequestDTO();
        request.setEmail(email);
        return request;
    }

    private AuthRequestDTO registrationRequest(String email, String username) {
        AuthRequestDTO request = new AuthRequestDTO();
        request.setEmail(email);
        request.setUsername(username);
        request.setPassword("password123");
        return request;
    }

    private PasswordResetRequestDTO passwordResetRequest(String email) {
        PasswordResetRequestDTO request = new PasswordResetRequestDTO();
        request.setEmail(email);
        return request;
    }
}
