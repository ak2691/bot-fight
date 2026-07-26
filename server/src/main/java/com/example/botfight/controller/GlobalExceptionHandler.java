package com.example.botfight.controller;

import com.example.botfight.security.RequestPayloadLimitExceededException;
import com.example.botfight.service.AuthException;
import com.example.botfight.service.SubmissionConflictException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler({
            HttpMessageNotReadableException.class,
            MethodArgumentTypeMismatchException.class,
            MissingServletRequestParameterException.class
    })
    ResponseEntity<ApiError> handleBadRequest(Exception exception, HttpServletRequest request) {
        if (hasCause(exception, RequestPayloadLimitExceededException.class)) {
            return response(HttpStatus.CONTENT_TOO_LARGE,
                    "Request payload exceeds the allowed size", request, null);
        }
        return response(HttpStatus.BAD_REQUEST, "Request payload or parameters are invalid", request, null);
    }

    @ExceptionHandler(RequestPayloadLimitExceededException.class)
    ResponseEntity<ApiError> handlePayloadTooLarge(
            RequestPayloadLimitExceededException exception,
            HttpServletRequest request) {
        return response(HttpStatus.CONTENT_TOO_LARGE,
                "Request payload exceeds the allowed size", request, null);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiError> handleConflict(DataIntegrityViolationException exception, HttpServletRequest request) {
        return response(HttpStatus.CONFLICT, "The request conflicts with existing data", request, exception);
    }

    @ExceptionHandler(AuthException.class)
    ResponseEntity<ApiError> handleForbidden(AuthException exception, HttpServletRequest request) {
        return response(HttpStatus.FORBIDDEN, "Request is not authorized", request, null);
    }

    @ExceptionHandler(SubmissionConflictException.class)
    ResponseEntity<ApiError> handleSubmissionConflict(
            SubmissionConflictException exception,
            HttpServletRequest request) {
        return response(HttpStatus.CONFLICT, exception.getMessage(), request, null);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception exception, HttpServletRequest request) {
        return response(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred", request, exception);
    }

    private ResponseEntity<ApiError> response(
            HttpStatus status,
            String message,
            HttpServletRequest request,
            Exception exception) {
        String requestId = UUID.randomUUID().toString();
        if (exception != null) {
            log.error("Request failed. requestId={}, method={}, path={}, status={}",
                    requestId,
                    request.getMethod(),
                    request.getRequestURI(),
                    status.value(),
                    exception);
        }
        return ResponseEntity.status(status).body(new ApiError(
                Instant.now(),
                status.value(),
                status.getReasonPhrase(),
                message,
                requestId));
    }

    private boolean hasCause(Throwable throwable, Class<? extends Throwable> type) {
        Throwable current = throwable;
        while (current != null) {
            if (type.isInstance(current)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    public record ApiError(Instant timestamp, int status, String error, String message, String requestId) {
    }
}
