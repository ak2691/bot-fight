package com.example.botfight.simulation.bots;

import org.springframework.stereotype.Service;

/** Owns comparator and boolean-join semantics for normalized bot conditions. */
@Service
public class ConditionEvaluationService {
    public boolean combine(boolean accumulated, boolean current, boolean first, String join) {
        if (first) return current;
        return BotLogicContracts.JOIN_OR.equals(join) ? accumulated || current : accumulated && current;
    }

    public boolean compareBooleans(boolean left, String comparator, boolean right) {
        return "neq".equals(comparator) ? left != right : left == right;
    }

    public boolean compareNumbers(double left, String comparator, double right) {
        if (!Double.isFinite(left) || !Double.isFinite(right)) return false;
        return switch (comparator) {
            case "lt" -> left < right;
            case "lte" -> left <= right;
            case "eq" -> left == right;
            case "neq" -> left != right;
            case "gte" -> left >= right;
            case "gt" -> left > right;
            default -> false;
        };
    }

    public boolean compareAngles(double left, String comparator, double right) {
        if (!Double.isFinite(left) || !Double.isFinite(right)) return false;
        if ("eq".equals(comparator)) return equivalentAngles(left, right);
        if ("neq".equals(comparator)) return !equivalentAngles(left, right);
        return compareNumbers(left, comparator, right)
                || compareNumbers(left - 360.0, comparator, right)
                || compareNumbers(left + 360.0, comparator, right);
    }

    private static boolean equivalentAngles(double left, double right) {
        double normalizedLeft = ((left % 360.0) + 360.0) % 360.0;
        double normalizedRight = ((right % 360.0) + 360.0) % 360.0;
        return Math.abs(normalizedLeft - normalizedRight) <= 1e-9;
    }

}
