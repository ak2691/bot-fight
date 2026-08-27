package com.example.botfight.service.puzzle;

import com.example.botfight.DTO.PuzzlePriorityMigrationResponse;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.UserRole;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.cache.DatabaseLookupCache;
import jakarta.persistence.EntityManager;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One-shot admin maintenance for old tree payloads. The helper function is
 * created and dropped inside the same transaction, so the database is not
 * left with a permanent maintenance routine after the button is used.
 */
@Service
public class PuzzlePriorityMigrationService {

    private static final String MIGRATION_LOCK_SQL =
            "SELECT pg_advisory_xact_lock(862091734)";

    private static final String CREATE_HELPER_FUNCTION_SQL = """
            CREATE OR REPLACE FUNCTION botfight_migrate_tree_priorities(node jsonb, parent_key text DEFAULT NULL)
            RETURNS jsonb
            LANGUAGE plpgsql
            IMMUTABLE
            AS $$
            DECLARE
                result jsonb;
                item record;
                legacy_order numeric;
            BEGIN
                IF jsonb_typeof(node) = 'array' THEN
                    SELECT COALESCE(
                        jsonb_agg(botfight_migrate_tree_priorities(entries.value, parent_key) ORDER BY entries.ordinality),
                        '[]'::jsonb
                    )
                    INTO result
                    FROM jsonb_array_elements(node) WITH ORDINALITY AS entries(value, ordinality);
                    RETURN result;
                END IF;

                IF jsonb_typeof(node) = 'object' THEN
                    result := '{}'::jsonb;
                    FOR item IN SELECT key, value FROM jsonb_each(node) LOOP
                        result := result || jsonb_build_object(
                            item.key,
                            botfight_migrate_tree_priorities(item.value, item.key)
                        );
                    END LOOP;

                    IF parent_key IN ('roots', 'branches', 'children')
                            AND jsonb_typeof(node -> 'createdOrder') = 'number' THEN
                        legacy_order := (node ->> 'createdOrder')::numeric;
                        result := (result - 'createdOrder' - 'priority')
                                || jsonb_build_object('priority', floor(legacy_order) + 1);
                    END IF;
                    RETURN result;
                END IF;

                RETURN node;
            END;
            $$;
            """;

    private static final String MIGRATE_PUZZLES_SQL = """
            UPDATE puzzles
            SET logic_configuration = botfight_migrate_tree_priorities(logic_configuration)
            WHERE logic_configuration::text LIKE '%"createdOrder"%'
            """;

    private static final String MIGRATE_PUZZLE_BOTS_SQL = """
            UPDATE puzzle_bots
            SET brain_payload = botfight_migrate_tree_priorities(brain_payload)
            WHERE brain_payload::text LIKE '%"createdOrder"%'
            """;

    private static final String MIGRATE_MATCH_ROUND_BOTS_SQL = """
            UPDATE match_round_bot_codes
            SET brain_payload = botfight_migrate_tree_priorities(brain_payload)
            WHERE brain_payload::text LIKE '%"createdOrder"%'
            """;

    private static final String DROP_HELPER_FUNCTION_SQL =
            "DROP FUNCTION IF EXISTS botfight_migrate_tree_priorities(jsonb, text)";

    private final EntityManager entityManager;
    private final CurrentUserService currentUserService;
    private final DatabaseLookupCache databaseLookupCache;

    public PuzzlePriorityMigrationService(
            EntityManager entityManager,
            CurrentUserService currentUserService,
            DatabaseLookupCache databaseLookupCache) {
        this.entityManager = entityManager;
        this.currentUserService = currentUserService;
        this.databaseLookupCache = databaseLookupCache;
    }

    @Transactional
    public PuzzlePriorityMigrationResponse migrateLegacyTreePriorities(
            Authentication authentication) {
        requireAdmin(authentication);

        // Prevent two admin clicks, or two application containers, from
        // creating/dropping the temporary helper concurrently.
        entityManager.createNativeQuery(MIGRATION_LOCK_SQL).getResultList();
        try {
            entityManager.createNativeQuery(CREATE_HELPER_FUNCTION_SQL).executeUpdate();
            int puzzleConfigurationsUpdated = entityManager
                    .createNativeQuery(MIGRATE_PUZZLES_SQL)
                    .executeUpdate();
            int puzzleBotBrainsUpdated = entityManager
                    .createNativeQuery(MIGRATE_PUZZLE_BOTS_SQL)
                    .executeUpdate();
            int matchRoundBotBrainsUpdated = entityManager
                    .createNativeQuery(MIGRATE_MATCH_ROUND_BOTS_SQL)
                    .executeUpdate();

            databaseLookupCache.logDatabaseWrite(
                    "puzzle-catalog",
                    "all",
                    "migrate-tree-priorities"
                            + " puzzleConfigurations=" + puzzleConfigurationsUpdated
                            + " puzzleBots=" + puzzleBotBrainsUpdated
                            + " matchRoundBots=" + matchRoundBotBrainsUpdated);
            databaseLookupCache.invalidatePuzzleCatalog("legacy-tree-priority-migration");
            return new PuzzlePriorityMigrationResponse(
                    puzzleConfigurationsUpdated,
                    puzzleBotBrainsUpdated,
                    matchRoundBotBrainsUpdated);
        } finally {
            entityManager.createNativeQuery(DROP_HELPER_FUNCTION_SQL).executeUpdate();
        }
    }

    private void requireAdmin(Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        if (user.getRole() != UserRole.ADMIN) {
            throw new AccessDeniedException("admin role is required");
        }
    }
}
