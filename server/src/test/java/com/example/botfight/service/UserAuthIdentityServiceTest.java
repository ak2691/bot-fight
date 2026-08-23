package com.example.botfight.service;

import com.example.botfight.service.auth.AuthException;
import com.example.botfight.service.auth.UserAuthIdentityService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.UserAuthIdentity;
import com.example.botfight.repository.UserAuthIdentityRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class UserAuthIdentityServiceTest {

    private final UserAuthIdentityRepository identityRepository =
            org.mockito.Mockito.mock(UserAuthIdentityRepository.class);
    private final UserAuthIdentityService service = new UserAuthIdentityService(identityRepository);

    @Test
    void linksNewProviderIdentityToUser() {
        AppUser user = user(UUID.randomUUID());
        when(identityRepository.findByProviderAndProviderSubject("google", "google-sub-123"))
                .thenReturn(Optional.empty());
        when(identityRepository.save(any(UserAuthIdentity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        UserAuthIdentity identity = service.linkIdentity(
                user,
                " Google ",
                " google-sub-123 ",
                "Pilot@Example.com",
                true);

        assertThat(identity.getUser()).isSameAs(user);
        assertThat(identity.getProvider()).isEqualTo("google");
        assertThat(identity.getProviderSubject()).isEqualTo("google-sub-123");
        assertThat(identity.getProviderEmail()).isEqualTo("Pilot@Example.com");
        assertThat(identity.isEmailVerified()).isTrue();
    }

    @Test
    void returnsExistingIdentityWhenAlreadyLinkedToSameUser() {
        AppUser user = user(UUID.randomUUID());
        UserAuthIdentity existing = identity(user, "google", "google-sub-123");
        when(identityRepository.findByProviderAndProviderSubject("google", "google-sub-123"))
                .thenReturn(Optional.of(existing));

        UserAuthIdentity identity = service.linkIdentity(
                user,
                "google",
                "google-sub-123",
                "pilot@example.com",
                true);

        assertThat(identity).isSameAs(existing);
        verify(identityRepository, never()).save(any(UserAuthIdentity.class));
    }

    @Test
    void rejectsProviderIdentityAlreadyLinkedToAnotherUser() {
        AppUser firstUser = user(UUID.randomUUID());
        AppUser secondUser = user(UUID.randomUUID());
        UserAuthIdentity existing = identity(firstUser, "google", "google-sub-123");
        when(identityRepository.findByProviderAndProviderSubject("google", "google-sub-123"))
                .thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> service.linkIdentity(
                secondUser,
                "google",
                "google-sub-123",
                "pilot@example.com",
                true))
                .isInstanceOf(AuthException.class)
                .hasMessage("auth identity is already linked to another user");
    }

    @Test
    void rejectsMissingProviderSubject() {
        AppUser user = user(UUID.randomUUID());

        assertThatThrownBy(() -> service.linkIdentity(user, "google", " ", null, false))
                .isInstanceOf(AuthException.class)
                .hasMessage("auth provider subject is required");
    }

    private UserAuthIdentity identity(AppUser user, String provider, String providerSubject) {
        UserAuthIdentity identity = new UserAuthIdentity();
        identity.setUser(user);
        identity.setProvider(provider);
        identity.setProviderSubject(providerSubject);
        return identity;
    }

    private AppUser user(UUID id) {
        AppUser user = new AppUser();
        user.setId(id);
        user.setEmail("pilot@example.com");
        user.setNormalizedEmail("pilot@example.com");
        user.setUsername("pilot");
        return user;
    }
}
