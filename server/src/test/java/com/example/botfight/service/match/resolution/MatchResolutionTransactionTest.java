package com.example.botfight.service.match.resolution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.botfight.service.match.MatchService;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

@DataJpaTest(showSql = false, properties = {
        "spring.flyway.enabled=false", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class MatchResolutionTransactionTest {
    @Autowired PlatformTransactionManager transactionManager;

    @Test
    void orchestrationSuspendsAnOuterTransactionSoWritesCanCommitBeforeMemoryCleanup() {
        MatchRoundResolutionService resolution = mock(MatchRoundResolutionService.class);
        when(resolution.completeSimulation(any())).thenAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            return List.of();
        });
        when(resolution.cancelFailedSimulation(any(), any())).thenAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            return List.of();
        });
        MatchService target = mock(MatchService.class, CALLS_REAL_METHODS);
        ReflectionTestUtils.setField(target, "matchRoundResolutionService", resolution);
        ProxyFactory factory = new ProxyFactory(target);
        factory.addAdvice(new TransactionInterceptor(
                transactionManager, new AnnotationTransactionAttributeSource()));
        MatchService service = (MatchService) factory.getProxy();

        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            service.completeSimulation(UUID.randomUUID());
            service.cancelFailedSimulation(UUID.randomUUID(), 1);
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
        });
    }
}
