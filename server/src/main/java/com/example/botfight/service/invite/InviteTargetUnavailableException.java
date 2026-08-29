package com.example.botfight.service.invite;

import com.example.botfight.service.auth.AuthException;

/**
 * An invite was valid for the recipient, but its party or lobby was removed
 * before the recipient acted on it. The message is safe to expose to the
 * client because it describes resource state rather than authorization data.
 */
public final class InviteTargetUnavailableException extends AuthException {

    public InviteTargetUnavailableException(String message) {
        super(message);
    }
}
