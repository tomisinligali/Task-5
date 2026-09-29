// Applying a discount code at checkout.
// All money is in minor units (cents) so we never touch float math.

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

export interface RedemptionTx {
  countRedemptionsForCustomer(codeId: string, userId: string): Promise<number>;
  countRedemptionsForCode(codeId: string): Promise<number>;
  insertRedemption(input: NewRedemption): Promise<Redemption>;
}

export interface DiscountRepo {
  findCode(normalizedCode: string): Promise<DiscountRule | null>;
  countRedemptionsForCustomer(codeId: string, userId: string): Promise<number>;
  countRedemptionsForCode(codeId: string): Promise<number>;
  runRedemptionTransaction<T>(
    codeId: string,
    work: (tx: RedemptionTx) => Promise<T>
  ): Promise<T>;
  isUniqueViolation(error: unknown): boolean;
}

function failure(
  code: FailureCode,
  message: string,
  details?: Record<string, unknown>
): Failure {
  return details ? { ok: false, code, message, details } : { ok: false, code, message };
}

export function createDiscountService(repo: DiscountRepo) {
  return async function applyDiscountCode(
    userId: string,
    cart: CartLine[],
    codeInput: string,
    nowUtc: Date,
    orderId: string
  ): Promise<ApplyResult> {
    // Stage 0 — who is asking
    if (!userId) {
      return failure("not_authenticated", "Sign in before applying a discount code.");
    }

    // Stage 1 — the cart has to make sense before we look at any code
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

      subtotal += line.unitPrice * line.quantity;
    }

    const cartCurrency = currency as string;

    // Stage 2 — normalize what the customer typed
    const normalized = codeInput.trim().toUpperCase();
    if (normalized === "") {
      return failure("code_required", "Enter a discount code.");
    }

    // Stage 3 — load the rule
    const rule = await repo.findCode(normalized);
    if (!rule || !rule.active) {
      return failure("code_not_found", "That discount code isn't valid.");
    }

    // Stage 4 — time window
    if (rule.startsAtUtc !== null && nowUtc < rule.startsAtUtc) {
      return failure("code_not_started", "That discount code isn't active yet.");
    }
    if (rule.expiresAtUtc !== null && nowUtc > rule.expiresAtUtc) {
      return failure("code_expired", "That discount code has expired.");
    }

    // Stage 5 — minimum spend
    if (subtotal < rule.minSubtotal) {
      return failure("min_spend_not_met", "Your subtotal is below this code's minimum.", {
        shortfall: rule.minSubtotal - subtotal,
      });
    }

    // Stage 6 — a fixed code only works in its own currency
    if (rule.kind === "FIXED" && rule.currency !== cartCurrency) {
      return failure("currency_mismatch", "That code can't be used with this cart's currency.", {
        expected: rule.currency,
        actual: cartCurrency,
      });
    }

    // Stage 7 — has this customer used it already?
    const customerUses = await repo.countRedemptionsForCustomer(rule.id, userId);
    if (customerUses >= rule.maxRedemptionsPerCustomer) {
      return failure("already_used", "You've already used this discount code.", {
        limit: rule.maxRedemptionsPerCustomer,
      });
    }

    // Stage 8 — is the code used up for everyone?
    if (rule.maxRedemptionsTotal !== null) {
      const totalUses = await repo.countRedemptionsForCode(rule.id);
      if (totalUses >= rule.maxRedemptionsTotal) {
        return failure("code_exhausted", "This discount code has been fully redeemed.");
      }
    }

    // Stage 9 — work out the actual discount
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

    // Stage 10 — write the redemption, re-checking the limits inside the lock
    try {
      const outcome = await repo.runRedemptionTransaction(rule.id, async (tx) => {
        const uses = await tx.countRedemptionsForCustomer(rule.id, userId);
        if (uses >= rule.maxRedemptionsPerCustomer) {
          return { kind: "failure" as const, failure: failure(
            "already_used",
            "You've already used this discount code.",
            { limit: rule.maxRedemptionsPerCustomer }
          ) };
        }

        if (rule.maxRedemptionsTotal !== null) {
          const used = await tx.countRedemptionsForCode(rule.id);
          if (used >= rule.maxRedemptionsTotal) {
            return { kind: "failure" as const, failure: failure(
              "code_exhausted",
              "This discount code has been fully redeemed."
            ) };
          }
        }

        const redemption = await tx.insertRedemption({
          codeId: rule.id,
          userId,
          orderId,
          discountAmount,
          subtotal,
          currency: cartCurrency,
          redeemedAtUtc: nowUtc,
        });
        return { kind: "redemption" as const, redemption };
      });

      if (outcome.kind === "failure") {
        return outcome.failure;
      }

      return {
        ok: true,
        code: rule.code,
        subtotal,
        discountAmount,
        total,
        currency: cartCurrency,
        redemptionId: outcome.redemption.id,
      };
    } catch (error) {
      if (repo.isUniqueViolation(error)) {
        return failure("duplicate_redemption", "This discount is already on your order.");
      }
      throw error;
    }
  };
}

// ---------------------------------------------------------------------------
// In-memory repository, good enough to run the hand traces. A real
// implementation would swap these methods for database calls.
// ---------------------------------------------------------------------------

class UniqueViolationError extends Error {
  constructor() {
    super("unique violation");
    this.name = "UniqueViolationError";
  }
}

export function createInMemoryRepo() {
  const codes = new Map<string, DiscountRule>();
  const redemptions: Redemption[] = [];
  const locks = new Map<string, Promise<unknown>>();
  let counter = 0;

  function addCode(rule: DiscountRule): void {
    codes.set(rule.code.trim().toUpperCase(), rule);
  }

  function seedRedemption(entry: NewRedemption): Redemption {
    const record: Redemption = { id: `seed_${++counter}`, ...entry };
    redemptions.push(record);
    return record;
  }

  function allRedemptions(): Redemption[] {
    return [...redemptions];
  }

  return {
    addCode,
    seedRedemption,
    allRedemptions,

    async findCode(normalizedCode: string): Promise<DiscountRule | null> {
      return codes.get(normalizedCode) ?? null;
    },

    async countRedemptionsForCustomer(codeId: string, userId: string): Promise<number> {
      return redemptions.filter((r) => r.codeId === codeId && r.userId === userId).length;
    },

    async countRedemptionsForCode(codeId: string): Promise<number> {
      return redemptions.filter((r) => r.codeId === codeId).length;
    },

    async runRedemptionTransaction<T>(
      codeId: string,
      work: (tx: RedemptionTx) => Promise<T>
    ): Promise<T> {
      const execute = async (): Promise<T> => {
        const staged: Redemption[] = [];
        const tx: RedemptionTx = {
          countRedemptionsForCustomer: async (id, uid) => {
            const saved = redemptions.filter((r) => r.codeId === id && r.userId === uid).length;
            const pending = staged.filter((r) => r.codeId === id && r.userId === uid).length;
            return saved + pending;
          },
          countRedemptionsForCode: async (id) => {
            const saved = redemptions.filter((r) => r.codeId === id).length;
            const pending = staged.filter((r) => r.codeId === id).length;
            return saved + pending;
          },
          insertRedemption: async (input) => {
            const clash = [...redemptions, ...staged].some(
              (r) => r.codeId === input.codeId && r.userId === input.userId
            );
            if (clash) {
              throw new UniqueViolationError();
            }
            const record: Redemption = { id: `red_${++counter}`, ...input };
            staged.push(record);
            return record;
          },
        };

        const result = await work(tx);
        redemptions.push(...staged);
        return result;
      };

      const previous = locks.get(codeId) ?? Promise.resolve();
      const current = previous.then(execute, execute);
      locks.set(codeId, current.then(() => undefined, () => undefined));
      return current;
    },

    isUniqueViolation(error: unknown): boolean {
      return error instanceof UniqueViolationError;
    },
  };
}
