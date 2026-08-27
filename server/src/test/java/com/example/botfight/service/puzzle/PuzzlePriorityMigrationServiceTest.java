package com.example.botfight.service.puzzle;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.botfight.DTO.PuzzlePriorityMigrationResponse;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.UserRole;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.cache.DatabaseLookupCache;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;

class PuzzlePriorityMigrationServiceTest {

    private final EntityManager entityManager = mock(EntityManager.class);
    private final Query query = mock(Query.class);
    private final CurrentUserService currentUserService = mock(CurrentUserService.class);
    private final DatabaseLookupCache databaseLookupCache = mock(DatabaseLookupCache.class);
    private final Authentication authentication = mock(Authentication.class);
    private final PuzzlePriorityMigrationService service = new PuzzlePriorityMigrationService(
            entityManager,
            currentUserService,
            databaseLookupCache);

    @Test
    void migratesAllJsonTablesAndInvalidatesPuzzleCaches() {
        AppUser admin = new AppUser();
        admin.setId(UUID.randomUUID());
        admin.setRole(UserRole.ADMIN);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(admin);
        when(entityManager.createNativeQuery(anyString())).thenReturn(query);
        when(query.getResultList()).thenReturn(List.of());
        when(query.executeUpdate()).thenReturn(0, 2, 1, 3, 0);

        PuzzlePriorityMigrationResponse response = service
                .migrateLegacyTreePriorities(authentication);

        assertThat(response.puzzleConfigurationsUpdated()).isEqualTo(2);
        assertThat(response.puzzleBotBrainsUpdated()).isEqualTo(1);
        assertThat(response.matchRoundBotBrainsUpdated()).isEqualTo(3);
        verify(databaseLookupCache).invalidatePuzzleCatalog("legacy-tree-priority-migration");
        verify(entityManager).createNativeQuery("DROP FUNCTION IF EXISTS botfight_migrate_tree_priorities(jsonb, text)");
    }

    @Test
    void rejectsNonAdminBeforeRunningDatabaseSql() {
        AppUser user = new AppUser();
        user.setRole(UserRole.USER);
        when(currentUserService.requireCurrentUser(authentication)).thenReturn(user);

        assertThatThrownBy(() -> service.migrateLegacyTreePriorities(authentication))
                .isInstanceOf(AccessDeniedException.class);
        verify(entityManager, never()).createNativeQuery(anyString());
    }
}
