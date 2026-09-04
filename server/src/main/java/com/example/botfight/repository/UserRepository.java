package com.example.botfight.repository;

import com.example.botfight.domain.auth.AppUser;
import java.util.Optional;
import java.util.UUID;
import java.time.Instant;
import org.springframework.data.domain.Page;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

public interface UserRepository extends JpaRepository<AppUser, UUID> {

    Optional<AppUser> findByUsernameIgnoreCase(String username);

    Optional<AppUser> findByUsernameIgnoreCaseAndEmailVerifiedTrue(String username);

    Page<AppUser> findByEmailVerifiedTrueAndUsernameContainingIgnoreCaseOrderByUsernameAscIdAsc(
            String username,
            Pageable pageable);

    Optional<AppUser> findByNormalizedEmail(String normalizedEmail);

    boolean existsByUsernameIgnoreCase(String username);

    boolean existsByUsernameIgnoreCaseAndIdNot(String username, UUID id);

    boolean existsByNormalizedEmail(String normalizedEmail);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Transactional
    @Query("""
            delete from AppUser u
            where u.createdAt < :cutoff
              and (
                    u.emailVerified = false
                    or (
                        u.username is null
                        and u.passwordHash is null
                        and exists (
                            select authIdentity.id
                            from UserAuthIdentity authIdentity
                            where authIdentity.user = u
                              and authIdentity.provider = 'google'
                        )
                    )
              )
            """)
    int deleteUnverifiedAccountsCreatedBefore(@Param("cutoff") Instant cutoff);
}
