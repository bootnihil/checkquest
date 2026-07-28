export interface BudgetStepperLimits {
  minimum:
    number;
  maximum:
    number;
}

export interface BudgetStepperAvailability {
  decrementDisabled:
    boolean;
  incrementDisabled:
    boolean;
}

function parseWholeNumber(
  value:
    string
): number | null {
  if (
    value.trim().length ===
      0
  ) {
    return null;
  }

  const parsed =
    Number(
      value
    );

  return Number.isInteger(
    parsed
  )
    ? parsed
    : null;
}

export function getBudgetStepperAvailability(
  value:
    string,
  limits:
    BudgetStepperLimits,
  locked:
    boolean
): BudgetStepperAvailability {
  const parsed =
    parseWholeNumber(
      value
    );

  return {
    decrementDisabled:
      locked ||
      parsed ===
        null ||
      parsed <=
        limits.minimum,
    incrementDisabled:
      locked ||
      parsed ===
        null ||
      parsed >=
        limits.maximum
  };
}

export function stepBudgetValue(
  value:
    string,
  direction:
    -1 | 1,
  limits:
    BudgetStepperLimits
): number {
  const parsed =
    parseWholeNumber(
      value
    );
  const fallback =
    direction ===
      1
      ? limits.minimum -
        1
      : limits.maximum +
        1;

  return Math.min(
    limits.maximum,
    Math.max(
      limits.minimum,
      (
        parsed ??
        fallback
      ) +
        direction
    )
  );
}
