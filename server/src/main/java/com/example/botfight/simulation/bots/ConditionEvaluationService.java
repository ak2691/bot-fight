package com.example.botfight.simulation.bots;

import org.springframework.stereotype.Service;

/** Owns comparator semantics for normalized bot conditions. */
@Service
public class ConditionEvaluationService {
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
        double positive = ((left % 360.0) + 360.0) % 360.0;
        double negative = positive - 360.0;
        return compareNumbers(positive, comparator, right)
                || positive != negative && compareNumbers(negative, comparator, right);
    }

    private static boolean equivalentAngles(double left, double right) {
        double normalizedLeft = ((left % 360.0) + 360.0) % 360.0;
        double normalizedRight = ((right % 360.0) + 360.0) % 360.0;
        return Math.abs(normalizedLeft - normalizedRight) <= 1e-9;
    }

}
