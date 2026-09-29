import { createApplyDiscountCode } from "./discount.ts";
import type { CartLine, Database, DiscountRule, Redemption, Transaction } from "./discount.ts";

const SPRING10: DiscountRule = {
  id: "c_spring10",
  code: "SPRING10",
  kind: "PERCENT",
  value: 10,
  minSubtotal: 3000,
  startsAtUtc: null,
  expiresAtUtc: new Date("2026-12-31T23:59:59Z"),
  active: true,
  maxRedemptionsTotal: null,
  maxRedemptionsPerCustomer: 1,
};

const FIVEOFF: DiscountRule = {
  id: "c_fiveoff",
  code: "FIVEOFF",
  kind: "FIXED",
  value: 1000,
  currency: "USD",
  minSubtotal: 0,
  startsAtUtc: null,
  expiresAtUtc: null,
  active: true,
  maxRedemptionsTotal: null,
  maxRedemptionsPerCustomer: 1,
};

class UniqueViolation extends Error {}

function createDb() {
  const codes = new Map<string, DiscountRule>([[SPRING10.code, SPRING10], [FIVEOFF.code, FIVEOFF]]);
  const redemptions: Redemption[] = [];
  let seq = 0;

  const db: Database = {
    async findDiscountCode(normalizedCode) {
      return codes.get(normalizedCode) ?? null;
    },
    async countRedemptions(codeId, userId) {
      return redemptions.filter((r) => r.codeId === codeId && r.userId === userId).length;
    },
    async countRedemptionsForCode(codeId) {
      return redemptions.filter((r) => r.codeId === codeId).length;
    },
    async runInTransaction<T>(work: (tx: Transaction) => Promise<T>) {
      // Serialize per code so the re-check inside the block is meaningful.
      const staged: Redemption[] = [];
      const tx: Transaction = {
        async countRedemptionsForUpdate(codeId, userId) {
          return redemptions.filter((r) => r.codeId === codeId && r.userId === userId).length;
        },
        async countRedemptionsForCodeForUpdate(codeId) {
          return redemptions.filter((r) => r.codeId === codeId).length;
        },
        async insertRedemption(input) {
          const clash = redemptions.some(
            (r) => r.codeId === input.codeId && r.userId === input.userId
          );
          if (clash) throw new UniqueViolation();
          const row: Redemption = { id: `red_${seq++}`, ...input };
          staged.push(row);
          return row;
        },
      };
      const out = await work(tx);
      redemptions.push(...staged);
      return out;
    },
    isUniqueViolation(error) {
      return error instanceof UniqueViolation;
    },
  };

  return { db, redemptions };
}

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok    ${label}: ${a}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}: expected ${e}, got ${a}`);
  }
}

const full: CartLine[] = [{ productId: "p1", unitPrice: 2000, quantity: 2, currency: "USD" }];

async function main() {
  {
    console.log("Trace 1 - valid percentage code");
    const { db } = createDb();
    const r = await createApplyDiscountCode(db)("u1", full, " spring10 ", new Date("2026-06-01"), "o1");
    check("ok", r.ok, true);
    if (r.ok) {
      check("subtotal", r.subtotal, 4000);
      check("discountAmount", r.discountAmount, 400);
      check("total", r.total, 3600);
      check("code", r.code, "SPRING10");
    }
  }
  {
    console.log("Trace 2 - expired code");
    const { db } = createDb();
    const r = await createApplyDiscountCode(db)("u1", full, "SPRING10", new Date("2027-01-01"), "o2");
    check("ok", r.ok, false);
    if (!r.ok) check("code", r.code, "code_expired");
  }
  {
    console.log("Trace 3 - already used by this customer");
    const { db, redemptions } = createDb();
    redemptions.push({
      id: "seed",
      codeId: SPRING10.id,
      userId: "u1",
      orderId: "o_old",
      discountAmount: 400,
      subtotal: 4000,
      currency: "USD",
      redeemedAtUtc: new Date("2026-05-01"),
    });
    const r = await createApplyDiscountCode(db)("u1", full, "SPRING10", new Date("2026-06-01"), "o3");
    check("ok", r.ok, false);
    if (!r.ok) {
      check("code", r.code, "already_used");
      check("limit", r.details?.limit, 1);
    }
  }
  {
    console.log("Trace 4 - negative quantity");
    const { db } = createDb();
    const cart: CartLine[] = [{ productId: "p1", unitPrice: 2000, quantity: -1, currency: "USD" }];
    const r = await createApplyDiscountCode(db)("u1", cart, "SPRING10", new Date("2026-06-01"), "o4");
    check("ok", r.ok, false);
    if (!r.ok) {
      check("code", r.code, "invalid_cart");
      check("reason", r.details?.reason, "quantity");
    }
  }
  {
    console.log("Trace 5 - below minimum spend");
    const { db } = createDb();
    const cart: CartLine[] = [{ productId: "p1", unitPrice: 1000, quantity: 1, currency: "USD" }];
    const r = await createApplyDiscountCode(db)("u1", cart, "SPRING10", new Date("2026-06-01"), "o5");
    check("ok", r.ok, false);
    if (!r.ok) {
      check("code", r.code, "min_spend_not_met");
      check("shortfall", r.details?.shortfall, 2000);
    }
  }
  {
    console.log("Trace 6 - unknown code");
    const { db } = createDb();
    const r = await createApplyDiscountCode(db)("u1", full, "NOPE", new Date("2026-06-01"), "o6");
    check("ok", r.ok, false);
    if (!r.ok) check("code", r.code, "code_not_found");
  }
  {
    console.log("Trace 7 - fixed discount capped at subtotal");
    const { db } = createDb();
    const cart: CartLine[] = [{ productId: "p1", unitPrice: 500, quantity: 1, currency: "USD" }];
    const r = await createApplyDiscountCode(db)("u1", cart, "FIVEOFF", new Date("2026-06-01"), "o7");
    check("ok", r.ok, true);
    if (r.ok) {
      check("discountAmount", r.discountAmount, 500);
      check("total", r.total, 0);
    }
  }

  if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("\nAll traces match the pseudocode.");
  }
}

main();
