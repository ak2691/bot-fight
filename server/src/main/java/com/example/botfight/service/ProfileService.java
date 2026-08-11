package com.example.botfight.service;

import com.example.botfight.DTO.AboutMeRequestDTO;
import com.example.botfight.DTO.ProfileDTO;
import com.example.botfight.DTO.MatchHistoryPageDTO;
import com.example.botfight.DTO.ProfileSearchPageDTO;
import com.example.botfight.DTO.ProfileDTO.RecentMatchDTO;
import com.example.botfight.DTO.UsernameRequestDTO;
import com.example.botfight.domain.AppUser;
import com.example.botfight.domain.MatchParticipant;
import com.example.botfight.domain.MatchResult;
import com.example.botfight.domain.Profile;
import com.example.botfight.repository.MatchParticipantRepository;
import com.example.botfight.repository.ProfileRepository;
import com.example.botfight.repository.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProfileService {

    private static final int MATCH_PAGE_SIZE = 20;
    private static final int MAX_HISTORY_PAGE = 10_000;
    private static final int MAX_OPPONENT_QUERY_LENGTH = 50;
    private static final int MAX_ABOUT_ME_LENGTH = 500;
    private static final int SEARCH_PAGE_SIZE = 20;
    private static final int MAX_SEARCH_PAGE = 10_000;
    private static final int MAX_USERNAME_QUERY_LENGTH = 50;
    private final CurrentUserService currentUserService;
    private final UserRepository userRepository;
    private final MatchParticipantRepository matchParticipantRepository;
    private final ProfileRepository profileRepository;

    public ProfileService(
            CurrentUserService currentUserService,
            UserRepository userRepository,
            MatchParticipantRepository matchParticipantRepository,
            ProfileRepository profileRepository) {
        this.currentUserService = currentUserService;
        this.userRepository = userRepository;
        this.matchParticipantRepository = matchParticipantRepository;
        this.profileRepository = profileRepository;
    }

    @Transactional(readOnly = true)
    public ProfileDTO currentProfile(Authentication authentication) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        return profileForUser(user);
    }

    @Transactional(readOnly = true)
    public ProfileDTO publicProfile(Authentication authentication, String username) {
        currentUserService.requireCurrentUser(authentication);
        return profileForUser(publicUser(username));
    }

    @Transactional
    public ProfileDTO updateUsername(Authentication authentication, UsernameRequestDTO request) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        String username = UsernamePolicy.clean(request == null ? null : request.getUsername());
        UsernamePolicy.validate(username);
        if (userRepository.existsByUsernameIgnoreCaseAndIdNot(username, user.getId())) {
            throw new AuthException("username is already taken");
        }

        user.setUsername(username);
        try {
            userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException exception) {
            throw new AuthException("username is already taken");
        }
        return profileForUser(user);
    }

    @Transactional
    public ProfileDTO updateAboutMe(Authentication authentication, AboutMeRequestDTO request) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        String aboutMe = normalizeAboutMe(request == null ? null : request.getAboutMe());
        Profile profile = profileRepository.findByUserId(user.getId())
                .orElseGet(() -> {
                    Profile created = new Profile();
                    created.setUser(user);
                    return created;
                });
        profile.setAboutMe(aboutMe);
        profileRepository.saveAndFlush(profile);
        return profileForUser(user);
    }

    private ProfileDTO profileForUser(AppUser user) {
        String aboutMe = profileRepository.findByUserId(user.getId())
                .map(Profile::getAboutMe)
                .orElse("");
        long wins = matchParticipantRepository.countByUserIdAndResult(user.getId(), MatchResult.WIN);
        long losses = matchParticipantRepository.countByUserIdAndResultIn(
                user.getId(),
                List.of(MatchResult.LOSS, MatchResult.FORFEIT));
        long draws = matchParticipantRepository.countByUserIdAndResult(user.getId(), MatchResult.DRAW);

        return new ProfileDTO(
                user.getUsername(),
                user.getCreatedAt(),
                aboutMe,
                wins + losses + draws,
                wins,
                losses,
                draws);
    }

    private String normalizeAboutMe(String value) {
        String normalized = value == null
                ? ""
                : value.replace("\r\n", "\n").replace('\r', '\n');
        if (normalized.length() > MAX_ABOUT_ME_LENGTH) {
            throw new AuthException("About Me must be 500 characters or fewer");
        }
        if (normalized.codePoints().anyMatch(codePoint -> Character.isISOControl(codePoint)
                && codePoint != '\n'
                && codePoint != '\t')) {
            throw new AuthException("About Me contains an unsupported control character");
        }
        return normalized;
    }

    @Transactional(readOnly = true)
    public MatchHistoryPageDTO matchHistory(
            Authentication authentication,
            int page,
            String query,
            Instant fromInclusive,
            Instant toExclusive) {
        AppUser user = currentUserService.requireCurrentUser(authentication);
        return matchHistoryForUser(user, page, query, fromInclusive, toExclusive);
    }

    @Transactional(readOnly = true)
    public MatchHistoryPageDTO publicMatchHistory(
            Authentication authentication,
            String username,
            int page,
            String query,
            Instant fromInclusive,
            Instant toExclusive) {
        currentUserService.requireCurrentUser(authentication);
        AppUser user = publicUser(username);
        return matchHistoryForUser(user, page, query, fromInclusive, toExclusive);
    }

    @Transactional(readOnly = true)
    public ProfileSearchPageDTO searchProfiles(Authentication authentication, int page, String query) {
        currentUserService.requireCurrentUser(authentication);
        int normalizedPage = Math.min(Math.max(0, page), MAX_SEARCH_PAGE);
        String normalizedQuery = query == null ? "" : query.trim();
        if (normalizedQuery.length() > MAX_USERNAME_QUERY_LENGTH) {
            normalizedQuery = normalizedQuery.substring(0, MAX_USERNAME_QUERY_LENGTH);
        }
        PageRequest pageRequest = PageRequest.of(
                Math.min(normalizedPage, MAX_SEARCH_PAGE),
                SEARCH_PAGE_SIZE,
                Sort.by(Sort.Direction.ASC, "username", "id"));
        Page<AppUser> profiles = normalizedQuery.isBlank()
                ? Page.empty(pageRequest)
                : userRepository.findByEmailVerifiedTrueAndUsernameContainingIgnoreCaseOrderByUsernameAscIdAsc(
                        normalizedQuery,
                        pageRequest);
        List<ProfileSearchPageDTO.ProfileSearchResultDTO> results = profiles.getContent().stream()
                .map(profile -> new ProfileSearchPageDTO.ProfileSearchResultDTO(profile.getUsername()))
                .toList();
        return new ProfileSearchPageDTO(
                results,
                pageRequest.getPageNumber(),
                SEARCH_PAGE_SIZE,
                profiles.hasNext(),
                profiles.getTotalElements());
    }

    private MatchHistoryPageDTO matchHistoryForUser(
            AppUser user,
            int page,
            String query,
            Instant fromInclusive,
            Instant toExclusive) {
        int normalizedPage = Math.min(Math.max(0, page), MAX_HISTORY_PAGE);
        String normalizedQuery = query == null ? "" : query.trim();
        if (normalizedQuery.length() > MAX_OPPONENT_QUERY_LENGTH) {
            normalizedQuery = normalizedQuery.substring(0, MAX_OPPONENT_QUERY_LENGTH);
        }

        Specification<MatchParticipant> filters = historyFilters(
                user.getId(),
                normalizedQuery,
                fromInclusive,
                toExclusive);
        PageRequest pageRequest = PageRequest.of(
                normalizedPage,
                MATCH_PAGE_SIZE,
                Sort.by(Sort.Direction.DESC, "match.completedAt", "match.id"));
        Page<MatchParticipant> matches = matchParticipantRepository.findAll(filters, pageRequest);
        List<RecentMatchDTO> recentMatches = matches.getContent().stream()
                .map(participant -> toRecentMatch(participant, user))
                .toList();
        return new MatchHistoryPageDTO(
                recentMatches,
                normalizedPage,
                MATCH_PAGE_SIZE,
                matches.hasNext(),
                matches.getTotalElements());
    }

    private AppUser publicUser(String username) {
        String normalizedUsername = UsernamePolicy.clean(username);
        if (!UsernamePolicy.isValid(normalizedUsername)) {
            throw new AuthException("profile not found");
        }
        return userRepository.findByUsernameIgnoreCaseAndEmailVerifiedTrue(normalizedUsername)
                .orElseThrow(() -> new AuthException("profile not found"));
    }

    private Specification<MatchParticipant> historyFilters(
            java.util.UUID userId,
            String opponentQuery,
            Instant fromInclusive,
            Instant toExclusive) {
        return (participant, historyQuery, criteriaBuilder) -> {
            List<Predicate> filters = new ArrayList<>();
            filters.add(criteriaBuilder.equal(participant.get("user").get("id"), userId));
            filters.add(criteriaBuilder.isNotNull(participant.get("result")));

            if (!opponentQuery.isBlank()) {
                Subquery<java.util.UUID> opponentExists = historyQuery.subquery(java.util.UUID.class);
                Root<MatchParticipant> opponent = opponentExists.from(MatchParticipant.class);
                String escapedQuery = opponentQuery
                        .toLowerCase(Locale.ROOT)
                        .replace("\\", "\\\\")
                        .replace("%", "\\%")
                        .replace("_", "\\_");
                opponentExists.select(opponent.get("id"));
                opponentExists.where(
                        criteriaBuilder.equal(
                                opponent.get("match").get("id"),
                                participant.get("match").get("id")),
                        criteriaBuilder.notEqual(opponent.get("user").get("id"), userId),
                        criteriaBuilder.like(
                                criteriaBuilder.lower(opponent.get("user").get("username")),
                                "%" + escapedQuery + "%",
                                '\\'));
                filters.add(criteriaBuilder.exists(opponentExists));
            }
            if (fromInclusive != null) {
                filters.add(criteriaBuilder.greaterThanOrEqualTo(
                        participant.get("match").get("completedAt"),
                        fromInclusive));
            }
            if (toExclusive != null) {
                filters.add(criteriaBuilder.lessThan(
                        participant.get("match").get("completedAt"),
                        toExclusive));
            }
            return criteriaBuilder.and(filters.toArray(Predicate[]::new));
        };
    }

    private RecentMatchDTO toRecentMatch(MatchParticipant participant, AppUser user) {
        String opponentUsername = matchParticipantRepository.findByMatchId(participant.getMatch().getId())
                .stream()
                .map(MatchParticipant::getUser)
                .filter(candidate -> !candidate.getId().equals(user.getId()))
                .map(AppUser::getUsername)
                .findFirst()
                .orElse("Unknown opponent");
        String result = participant.getResult() == MatchResult.FORFEIT
                ? MatchResult.LOSS.name()
                : participant.getResult().name();

        return new RecentMatchDTO(
                participant.getMatch().getId(),
                opponentUsername,
                result,
                participant.getMatch().getCompletedAt(),
                participant.getMatch().getCompletionReason());
    }
}
