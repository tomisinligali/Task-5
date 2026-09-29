import { createDiscountService, createInMemoryRepo } from "./discount.ts";
import type { CartLine, DiscountRule } from "./discount.ts";

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

function freshService() {
  const repo = createInMemoryRepo();
  repo.addCode(SPRING10);
  repo.addCode(FIVEOFF);
  return { repo, applyDiscountCode: createDiscountService(repo) };
}

let failures = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${label}: ${a}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}: expected ${e}, got ${a}`);
  }
}

async function trace1Valid() {
  console.log("Trace 1 - valid percentage code");
  const { applyDiscountCode } = freshService();
  const cart: CartLine[] = [{ productId: "p1", unitPrice: 2000, quantity: 2, currency: "USD" }];
  const result = await applyDiscountCode("u1", cart, " spring10 ", new Date("2026-06-01"), "o1");
  expect("ok", result.ok, true);
  if (result.ok) {
    expect("subtotal", result.subtotal, 4000);
    expect("discountAmount", result.discountAmount, 400);
    expect("total", result.total, 3600);
    expect("code", result.code, "SPRING10");
  }
}

async function trace2Expired() {
  console.log("Trace 2 - expired code");
  const { applyDiscountCode } = freshService();
  const cart: CartLine[] = [{ productId: "p1", unitPrice: 2000, quantity: 2, currency: "USD" }];
  const result = await applyDiscountCode("u1", cart, "SPRING10", new Date("2027-01-01"), "o2");
  expect("ok", result.ok, false);
  if (!result.ok) {
    expect("code", result.code, "code_expired");
  }
}

async function trace3UsedTwice() {
  console.log("Trace 3 - code already used by this customer");
  const { repo, applyDiscountCode } = freshService();
  repo.seedRedemption({
    codeId: SPRING10.id,
    userId: "u1",
    orderId: "o_old",
    discountAmount: 400,
    subtotal: 4000,
    currency: "USD",
    redeemedAtUtc: new Date("2026-05-01"),
  });
  const cart: CartLine[] = [{ productId: "p1", unitPrice: 2000, quantity: 2, currency: "USD" }];
  const result = await applyDiscountCode("u1", cart, "SPRING10", new Date("2026-06-01"), "o3");
  expect("ok", result.ok, false);
  if (!result.ok) {
    expect("code", result.code, "already_used");
    expect("limit", result.details?.limit, 1);
  }
}

async function trace4NegativeQuantity() {
  console.log("Trace 4 - negative quantity");
  const { applyDiscountCode } = freshService();
  const cart: CartLine[] = [{ productId: "p1", unitPrice: 2000, quantity: -1, currency: "USD" }];
  const result = await applyDiscountCode("u1", cart, "SPRING10", new Date("2026-06-01"), "o4");
  expect("ok", result.ok, false);
  if (!result.ok) {
    expect("code", result.code, "invalid_cart");
    expect("reason", result.details?.reason, "quantity");
  }
}

async function trace5BelowMinimum() {
  console.log("Trace 5 - subtotal below minimum spend");
  const { applyDiscountCode } = freshService();
  const cart: CartLine[] = [{ productId: "p1", unitPrice: 1000, quantity: 1, currency: "USD" }];
  const result = await applyDiscountCode("u1", cart, "SPRING10", new Date("2026-06-01"), "o5");
  expect("ok", result.ok, false);
  if (!result.ok) {
    expect("code", result.code, "min_spend_not_met");
    expect("shortfall", result.details?.shortfall, 2000);
  }
}

async function trace6UnknownCode() {
  console.log("Trace 6 - unknown code");
  const { applyDiscountCode } = freshService();
  const cart: CartLine[] = [{ productId: "p1", unitPrice: 2000, quantity: 2, currency: "USD" }];
  const result = await applyDiscountCode("u1", cart, "NOPE", new Date("2026-06-01"), "o6");
  expect("ok", result.ok, false);
  if (!result.ok) {
    expect("code", result.code, "code_not_found");
  }
}

async function trace7DiscountCapped() {
  console.log("Trace 7 - fixed discount larger than subtotal is capped");
  const { applyDiscountCode } = freshService();
  const cart: CartLine[] = [{ productId: "p1", unitPrice: 500, quantity: 1, currency: "USD" }];
  const result = await applyDiscountCode("u1", cart, "FIVEOFF", new Date("2026-06-01"), "o7");
  expect("ok", result.ok, true);
  if (result.ok) {
    expect("discountAmount", result.discountAmount, 500);
    expect("total", result.total, 0);
  }
}

async function main() {
  await trace1Valid();
  await trace2Expired();
  await trace3UsedTwice();
  await trace4NegativeQuantity();
  await trace5BelowMinimum();
  await trace6UnknownCode();
  await trace7DiscountCapped();

  if (failures > 0) {
    console.log(`\n${failures} trace check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("\nAll traces match the pseudocode.");
  }
}

main();
