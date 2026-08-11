package com.example.botfight.simulation.bot;

import org.springframework.stereotype.Service;

/** Owns comparator, modulo, and boolean-join semantics for normalized bot conditions. */
@Service
public class ConditionEvaluationService {
    public boolean combine(boolean accumulated, boolean current, boolean first, String join) {
        if (first) return current;
        return "or".equals(join) ? accumulated || current : accumulated && current;
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

    public boolean compareModulo(double left, double divisor, String comparator, double right) {
        if (!Double.isFinite(left) || !Double.isFinite(divisor) || divisor == 0
                || !Double.isFinite(right)) return false;
        return compareNumbers(Math.floor(left) % divisor, comparator, Math.floor(right));
    }
}
