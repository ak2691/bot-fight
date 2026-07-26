package com.example.botfight.security;

import com.example.botfight.config.BotFightSecurityProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

public class RequestPayloadLimitFilter extends OncePerRequestFilter {

    private final int maxRequestBytes;

    public RequestPayloadLimitFilter(BotFightSecurityProperties properties) {
        this.maxRequestBytes = properties.getMaxHttpRequestBytes();
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        if (request.getContentLengthLong() > maxRequestBytes) {
            writePayloadTooLarge(response);
            return;
        }

        try {
            filterChain.doFilter(new LimitedRequestWrapper(request, maxRequestBytes), response);
        } catch (RuntimeException | ServletException ex) {
            if (hasPayloadLimitCause(ex)) {
                writePayloadTooLarge(response);
                return;
            }
            throw ex;
        }
    }

    private boolean hasPayloadLimitCause(Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof RequestPayloadLimitExceededException) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private void writePayloadTooLarge(HttpServletResponse response) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.reset();
        response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"status\":413,\"error\":\"Payload Too Large\","
                + "\"message\":\"Request payload exceeds the allowed size\"}");
    }

    private static final class LimitedRequestWrapper extends HttpServletRequestWrapper {
        private final int maxRequestBytes;
        private ServletInputStream inputStream;

        private LimitedRequestWrapper(HttpServletRequest request, int maxRequestBytes) {
            super(request);
            this.maxRequestBytes = maxRequestBytes;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (inputStream == null) {
                inputStream = new LimitedServletInputStream(super.getInputStream(), maxRequestBytes);
            }
            return inputStream;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
        }
    }

    private static final class LimitedServletInputStream extends ServletInputStream {
        private final ServletInputStream delegate;
        private final int maxRequestBytes;
        private int bytesRead;

        private LimitedServletInputStream(ServletInputStream delegate, int maxRequestBytes) {
            this.delegate = delegate;
            this.maxRequestBytes = maxRequestBytes;
        }

        @Override
        public int read() throws IOException {
            int value = delegate.read();
            if (value >= 0) {
                recordBytes(1);
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = delegate.read(buffer, offset, length);
            if (count > 0) {
                recordBytes(count);
            }
            return count;
        }

        @Override
        public long skip(long count) throws IOException {
            long skipped = delegate.skip(Math.min(count, (long) maxRequestBytes - bytesRead + 1));
            if (skipped > 0) {
                recordBytes((int) skipped);
            }
            return skipped;
        }

        private void recordBytes(int count) {
            bytesRead += count;
            if (bytesRead > maxRequestBytes) {
                throw new RequestPayloadLimitExceededException();
            }
        }

        @Override
        public boolean isFinished() {
            return delegate.isFinished();
        }

        @Override
        public boolean isReady() {
            return delegate.isReady();
        }

        @Override
        public void setReadListener(ReadListener readListener) {
            delegate.setReadListener(readListener);
        }
    }
}
