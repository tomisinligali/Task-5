// C1 — AI implementation of the B1 pseudocode.
// One function; each block below maps 1:1 to a pseudocode block.
// No behaviour was added beyond the pseudocode.

export type DiscountKind = "PERCENT" | "FIXED";

export interface CartLine {
  productId: string;
  unitPrice: number;
  quantity: number;
  currency: string;
}

export interface DiscountRule {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  currency?: string;
  minSubtotal: number;
  startsAtUtc: Date | null;
  expiresAtUtc: Date | null;
  active: boolean;
  maxRedemptionsTotal: number | null;
  maxRedemptionsPerCustomer: number;
}

export interface Redemption {
  id: string;
  codeId: string;
  userId: string;
  orderId: string;
  discountAmount: number;
  subtotal: number;
  currency: string;
  redeemedAtUtc: Date;
}

export type NewRedemption = Omit<Redemption, "id">;

export type FailureCode =
  | "not_authenticated"
  | "empty_cart"
  | "invalid_cart"
  | "code_required"
  | "code_not_found"
  | "code_not_started"
  | "code_expired"
  | "min_spend_not_met"
  | "currency_mismatch"
  | "already_used"
  | "code_exhausted"
  | "duplicate_redemption";

export interface Failure {
  ok: false;
  code: FailureCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface Success {
  ok: true;
  code: string;
  subtotal: number;
  discountAmount: number;
  total: number;
  currency: string;
  redemptionId: string;
}

export type ApplyResult = Success | Failure;

// The pseudocode's `database.*` calls, plus the BEGIN/COMMIT/ROLLBACK block.
export interface Transaction {
  countRedemptionsForUpdate(codeId: string, userId: string): Promise<number>;
  countRedemptionsForCodeForUpdate(codeId: string): Promise<number>;
  insertRedemption(input: NewRedemption): Promise<Redemption>;
}

export interface Database {
  findDiscountCode(normalizedCode: string): Promise<DiscountRule | null>;
  countRedemptions(codeId: string, userId: string): Promise<number>;
  countRedemptionsForCode(codeId: string): Promise<number>;
  runInTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  isUniqueViolation(error: unknown): boolean;
}

function failure(
  code: FailureCode,
  message: string,
  details?: Record<string, unknown>
): Failure {
  return details ? { ok: false, code, message, details } : { ok: false, code, message };
}

export function createApplyDiscountCode(database: Database) {
  return async function applyDiscountCode(
    userId: string,
    cart: CartLine[],
    codeInput: string,
    nowUtc: Date,
    orderId: string
  ): Promise<ApplyResult> {
    // ---- Stage 0: identity ----
    if (!userId) {
      return failure("not_authenticated", "Sign in before applying a discount code.");
    }

    // ---- Stage 1: validate cart ----
    if (!cart || cart.length === 0) {
      return failure("empty_cart", "Your cart is empty.");
    }

    let currency: string | null = null;
    let subtotal = 0;

    for (const line of cart) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        return failure("invalid_cart", "A cart item has an invalid quantity.", {
          reason: "quantity",
          productId: line.productId,
        });
      }
      if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) {
        return failure("invalid_cart", "A cart item has an invalid price.", {
          reason: "unitPrice",
          productId: line.productId,
        });
      }

      if (currency === null) {
        currency = line.currency;
      } else if (currency !== line.currency) {
        return failure("invalid_cart", "Cart items have to share one currency.", {
          reason: "mixed_currency",
        });
      }

      subtotal = subtotal + line.unitPrice * line.quantity;
    }

    const cartCurrency = currency as string;

    // ---- Stage 2: validate code input ----
    const normalized = codeInput.trim().toUpperCase();
    if (normalized.length === 0) {
      return failure("code_required", "Enter a discount code.");
    }

    // ---- Stage 3: load the code ----
    const rule = await database.findDiscountCode(normalized);
    if (rule === null || rule.active === false) {
      return failure("code_not_found", "That discount code isn't valid.");
    }

    // ---- Stage 4: time window ----
    if (rule.startsAtUtc !== null && nowUtc < rule.startsAtUtc) {
      return failure("code_not_started", "That discount code isn't active yet.");
    }
    if (rule.expiresAtUtc !== null && nowUtc > rule.expiresAtUtc) {
      return failure("code_expired", "That discount code has expired.");
    }

    // ---- Stage 5: minimum spend ----
    if (subtotal < rule.minSubtotal) {
      return failure("min_spend_not_met", "Your subtotal is below this code's minimum.", {
        shortfall: rule.minSubtotal - subtotal,
      });
    }

    // ---- Stage 6: currency compatibility (fixed only) ----
    if (rule.kind === "FIXED" && rule.currency !== cartCurrency) {
      return failure("currency_mismatch", "That code can't be used with this cart's currency.", {
        expected: rule.currency,
        actual: cartCurrency,
      });
    }

    // ---- Stage 7: per-customer limit ----
    const customerUses = await database.countRedemptions(rule.id, userId);
    if (customerUses >= rule.maxRedemptionsPerCustomer) {
      return failure("already_used", "You've already used this discount code.", {
        limit: rule.maxRedemptionsPerCustomer,
      });
    }

    // ---- Stage 8: total cap ----
    if (rule.maxRedemptionsTotal !== null) {
      const totalUses = await database.countRedemptionsForCode(rule.id);
      if (totalUses >= rule.maxRedemptionsTotal) {
        return failure("code_exhausted", "This discount code has been fully redeemed.");
      }
    }

    // ---- Stage 9: compute the discount ----
    let rawDiscount: number;
    if (rule.kind === "PERCENT") {
      rawDiscount = Math.floor((subtotal * rule.value) / 100);
    } else if (rule.kind === "FIXED") {
      rawDiscount = rule.value;
    } else {
      return failure("code_not_found", "That discount code isn't valid.");
    }

    const discountAmount = Math.min(rawDiscount, subtotal);
    const total = subtotal - discountAmount;

    // ---- Stage 10: record the redemption ----
    try {
      const redemption = await database.runInTransaction(async (tx) => {
        const uses = await tx.countRedemptionsForUpdate(rule.id, userId);
        if (uses >= rule.maxRedemptionsPerCustomer) {
          throw new LimitReached("already_used");
        }

        if (rule.maxRedemptionsTotal !== null) {
          const used = await tx.countRedemptionsForCodeForUpdate(rule.id);
          if (used >= rule.maxRedemptionsTotal) {
            throw new LimitReached("code_exhausted");
          }
        }

        return tx.insertRedemption({
          codeId: rule.id,
          userId,
          orderId,
          discountAmount,
          subtotal,
          currency: cartCurrency,
          redeemedAtUtc: nowUtc,
        });
      });

      return {
        ok: true,
        code: rule.code,
        subtotal,
        discountAmount,
        total,
        currency: cartCurrency,
        redemptionId: redemption.id,
      };
    } catch (error) {
      if (error instanceof LimitReached) {
        return failure(
          error.code,
          error.code === "already_used"
            ? "You've already used this discount code."
            : "This discount code has been fully redeemed."
        );
      }
      if (database.isUniqueViolation(error)) {
        return failure("duplicate_redemption", "This discount is already on your order.");
      }
      throw error;
    }
  };
}

// Control-flow signal for the ROLLBACK + RETURN branches inside Stage 10.
class LimitReached extends Error {
  readonly code: FailureCode;
  constructor(code: "already_used" | "code_exhausted") {
    super(code);
    this.code = code;
  }
}
