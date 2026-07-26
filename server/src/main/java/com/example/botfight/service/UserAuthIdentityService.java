package com.example.botfight.service;

import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.UserAuthIdentity;
import com.example.botfight.repository.UserAuthIdentityRepository;
import java.util.Locale;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserAuthIdentityService {

    private final UserAuthIdentityRepository identityRepository;

    public UserAuthIdentityService(UserAuthIdentityRepository identityRepository) {
        this.identityRepository = identityRepository;
    }

    @Transactional
    public UserAuthIdentity linkIdentity(
            AppUser user,
            String provider,
            String providerSubject,
            String providerEmail,
            boolean emailVerified) {
        if (user == null || user.getId() == null) {
            throw new AuthException("user is required");
        }

        String normalizedProvider = normalizeProvider(provider);
        String cleanedSubject = clean(providerSubject);
        if (normalizedProvider == null) {
            throw new AuthException("auth provider is required");
        }
        if (cleanedSubject == null) {
            throw new AuthException("auth provider subject is required");
        }

        return identityRepository.findByProviderAndProviderSubject(normalizedProvider, cleanedSubject)
                .map(existing -> ensureIdentityBelongsToUser(existing, user))
                .orElseGet(() -> saveIdentity(
                        user,
                        normalizedProvider,
                        cleanedSubject,
                        clean(providerEmail),
                        emailVerified));
    }

    private UserAuthIdentity ensureIdentityBelongsToUser(UserAuthIdentity identity, AppUser user) {
        if (!Objects.equals(identity.getUser().getId(), user.getId())) {
            throw new AuthException("auth identity is already linked to another user");
        }
        return identity;
    }

    private UserAuthIdentity saveIdentity(
            AppUser user,
            String provider,
            String providerSubject,
            String providerEmail,
            boolean emailVerified) {
        UserAuthIdentity identity = new UserAuthIdentity();
        identity.setUser(user);
        identity.setProvider(provider);
        identity.setProviderSubject(providerSubject);
        identity.setProviderEmail(providerEmail);
        identity.setEmailVerified(emailVerified);
        return identityRepository.save(identity);
    }

    private String normalizeProvider(String provider) {
        String cleaned = clean(provider);
        return cleaned == null ? null : cleaned.toLowerCase(Locale.ROOT);
    }

    private String clean(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        return value.trim();
    }
}
