package com.example.botfight.controller;

import com.example.botfight.DTO.match.MatchAbilityGuaranteeRequestDTO;
import com.example.botfight.DTO.match.MatchAbilityGuaranteeResponseDTO;
import com.example.botfight.service.auth.CurrentUserService;
import com.example.botfight.service.match.loadout.MatchAbilityGuaranteeService;
import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/match-preferences")
public class MatchAbilityGuaranteeController {

    private final CurrentUserService currentUserService;
    private final MatchAbilityGuaranteeService guaranteeService;

    public MatchAbilityGuaranteeController(
            CurrentUserService currentUserService,
            MatchAbilityGuaranteeService guaranteeService) {
        this.currentUserService = currentUserService;
        this.guaranteeService = guaranteeService;
    }

    @GetMapping("/ability-guarantees")
    public MatchAbilityGuaranteeResponseDTO get(Authentication authentication) {
        return MatchAbilityGuaranteeResponseDTO.from(
                guaranteeService.forUser(currentUserService.requireCurrentUserId(authentication)));
    }

    @PostMapping("/ability-guarantees")
    public MatchAbilityGuaranteeResponseDTO save(
            Authentication authentication,
            @RequestBody MatchAbilityGuaranteeRequestDTO request) {
        List<Integer> requested = request == null ? List.of() : request.guaranteedAbilityIds();
        return MatchAbilityGuaranteeResponseDTO.from(
                guaranteeService.setForUser(
                        currentUserService.requireCurrentUserId(authentication),
                        requested));
    }
}
