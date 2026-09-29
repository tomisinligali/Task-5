// C3 — run B2 and C1 against the same inputs and compare.
// One shared in-memory store shapes the database for both implementations.

import { createDiscountService } from "../../part-b/implementation/discount.ts";
import { createApplyDiscountCode } from "../c1-ai-implemented/discount.ts";

class UniqueViolation extends Error {}

function makeStore(codes: any[], seed: any[] = []) {
  return {
    codes: codes.map((c) => ({ ...c })),
    redemptions: seed.map((r) => ({ ...r })),
    seq: 0,
  };
}

function ruleFor(store: any, codeId: string) {
  return store.codes.find((c: any) => c.id === codeId);
}

function insert(store: any, staged: any[], input: any) {
  const rule = ruleFor(store, input.codeId);
  const perCustomer = rule ? rule.maxRedemptionsPerCustomer : 1;
  if (perCustomer === 1) {
    const clash = [...store.redemptions, ...staged].some(
      (r) => r.codeId === input.codeId && r.userId === input.userId
    );
    if (clash) throw new UniqueViolation();
  }
  const row = { id: `r_${++store.seq}`, ...input };
  staged.push(row);
  return row;
}

function count(store: any, staged: any[], codeId: string, userId?: string) {
  return [...store.redemptions, ...staged].filter(
    (r) => r.codeId === codeId && (userId === undefined || r.userId === userId)
  ).length;
}

// Adapter for the B2 implementation's DiscountRepo.
function b2Repo(store: any) {
  const locks = new Map<string, Promise<unknown>>();
  return {
    async findCode(normalized: string) {
      return store.codes.find((c: any) => c.code.trim().toUpperCase() === normalized) ?? null;
    },
    async countRedemptionsForCustomer(codeId: string, userId: string) {
      return count(store, [], codeId, userId);
    },
    async countRedemptionsForCode(codeId: string) {
      return count(store, [], codeId);
    },
    async runRedemptionTransaction<T>(
      codeId: string,
      work: (tx: any) => Promise<T>
    ): Promise<T> {
      const run = async () => {
        const staged: any[] = [];
        const tx = {
          countRedemptionsForCustomer: async (c: string, u: string) => count(store, staged, c, u),
          countRedemptionsForCode: async (c: string) => count(store, staged, c),
          insertRedemption: async (input: any) => insert(store, staged, input),
        };
        const out = await work(tx);
        store.redemptions.push(...staged);
        return out;
      };
      const prev = locks.get(codeId) ?? Promise.resolve();
      const current = prev.then(run, run);
      locks.set(codeId, current.then(() => undefined, () => undefined));
      return current;
    },
    isUniqueViolation(error: unknown) {
      return error instanceof UniqueViolation;
    },
  };
}

// Adapter for the C1 implementation's Database.
function c1Db(store: any) {
  const locks = new Map<string, Promise<unknown>>();
  return {
    async findDiscountCode(normalized: string) {
      return store.codes.find((c: any) => c.code.trim().toUpperCase() === normalized) ?? null;
    },
    async countRedemptions(codeId: string, userId: string) {
      return count(store, [], codeId, userId);
    },
    async countRedemptionsForCode(codeId: string) {
      return count(store, [], codeId);
    },
    async runInTransaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
      const key = "global";
      const run = async () => {
        const staged: any[] = [];
        const tx = {
          countRedemptionsForUpdate: async (c: string, u: string) => count(store, staged, c, u),
          countRedemptionsForCodeForUpdate: async (c: string) => count(store, staged, c),
          insertRedemption: async (input: any) => insert(store, staged, input),
        };
        const out = await work(tx);
        store.redemptions.push(...staged);
        return out;
      };
      const prev = locks.get(key) ?? Promise.resolve();
      const current = prev.then(run, run);
      locks.set(key, current.then(() => undefined, () => undefined));
      return current;
    },
    isUniqueViolation(error: unknown) {
      return error instanceof UniqueViolation;
    },
  };
}

function normalize(result: any) {
  if (result.ok) {
    return {
      ok: true,
      code: result.code,
      subtotal: result.subtotal,
      discountAmount: result.discountAmount,
      total: result.total,
      currency: result.currency,
    };
  }
  return { ok: false, code: result.code, details: result.details ?? null };
}

const SPRING10 = {
  id: "c_spring", code: "SPRING10", kind: "PERCENT", value: 10, minSubtotal: 3000,
  startsAtUtc: null, expiresAtUtc: new Date("2026-12-31T23:59:59Z"), active: true,
  maxRedemptionsTotal: null, maxRedemptionsPerCustomer: 1,
};
const FIVEOFF = {
  id: "c_five", code: "FIVEOFF", kind: "FIXED", value: 1000, currency: "USD", minSubtotal: 0,
  startsAtUtc: null, expiresAtUtc: null, active: true,
  maxRedemptionsTotal: null, maxRedemptionsPerCustomer: 1,
};
const FUTURE10 = {
  id: "c_future", code: "FUTURE10", kind: "PERCENT", value: 10, minSubtotal: 0,
  startsAtUtc: new Date("2026-12-01T00:00:00Z"), expiresAtUtc: null, active: true,
  maxRedemptionsTotal: null, maxRedemptionsPerCustomer: 1,
};
const LASTONE20 = {
  id: "c_last", code: "LASTONE20", kind: "PERCENT", value: 20, minSubtotal: 0,
  startsAtUtc: null, expiresAtUtc: null, active: true,
  maxRedemptionsTotal: 1, maxRedemptionsPerCustomer: 1,
};
const INACTIVE50 = {
  id: "c_inactive", code: "INACTIVE50", kind: "PERCENT", value: 50, minSubtotal: 0,
  startsAtUtc: null, expiresAtUtc: null, active: false,
  maxRedemptionsTotal: null, maxRedemptionsPerCustomer: 1,
};
const MULTI10 = {
  id: "c_multi", code: "MULTI10", kind: "PERCENT", value: 10, minSubtotal: 0,
  startsAtUtc: null, expiresAtUtc: null, active: true,
  maxRedemptionsTotal: null, maxRedemptionsPerCustomer: 2,
};

const ALL = [SPRING10, FIVEOFF, FUTURE10, LASTONE20, INACTIVE50, MULTI10];

const usd = (price: number, qty: number) => ({ productId: "p1", unitPrice: price, quantity: qty, currency: "USD" });

interface Scenario {
  name: string;
  seed?: any[];
  cart: any[];
  codeInput: string;
  now: Date;
  userId?: string;
}

const scenarios: Scenario[] = [
  { name: "1 valid percent", cart: [usd(2000, 2)], codeInput: " spring10 ", now: new Date("2026-06-01") },
  { name: "2 expired", cart: [usd(2000, 2)], codeInput: "SPRING10", now: new Date("2027-01-01") },
  {
    name: "3 already used",
    seed: [{ id: "seed", codeId: "c_spring", userId: "u1", orderId: "old", discountAmount: 400, subtotal: 4000, currency: "USD", redeemedAtUtc: new Date("2026-05-01") }],
    cart: [usd(2000, 2)], codeInput: "SPRING10", now: new Date("2026-06-01"),
  },
  { name: "4 negative qty", cart: [usd(2000, -1)], codeInput: "SPRING10", now: new Date("2026-06-01") },
  { name: "5 below minimum", cart: [usd(1000, 1)], codeInput: "SPRING10", now: new Date("2026-06-01") },
  { name: "6 unknown code", cart: [usd(2000, 2)], codeInput: "NOPE", now: new Date("2026-06-01") },
  { name: "7 fixed capped", cart: [usd(500, 1)], codeInput: "FIVEOFF", now: new Date("2026-06-01") },
  { name: "8 zero qty", cart: [usd(2000, 0)], codeInput: "SPRING10", now: new Date("2026-06-01") },
  { name: "9 mixed currency", cart: [usd(2000, 1), { productId: "p2", unitPrice: 1000, quantity: 1, currency: "EUR" }], codeInput: "SPRING10", now: new Date("2026-06-01") },
  { name: "10 not started", cart: [usd(1000, 1)], codeInput: "FUTURE10", now: new Date("2026-06-01") },
  {
    name: "11 total cap reached",
    seed: [{ id: "seed", codeId: "c_last", userId: "u2", orderId: "old", discountAmount: 200, subtotal: 1000, currency: "USD", redeemedAtUtc: new Date("2026-05-01") }],
    cart: [usd(1000, 1)], codeInput: "LASTONE20", now: new Date("2026-06-01"),
  },
  { name: "12 fixed currency mismatch", cart: [{ productId: "p1", unitPrice: 1000, quantity: 1, currency: "EUR" }], codeInput: "FIVEOFF", now: new Date("2026-06-01") },
  { name: "13 percent rounding", cart: [usd(3333, 1)], codeInput: "SPRING10", now: new Date("2026-06-01") },
  { name: "14 inactive code", cart: [usd(1000, 1)], codeInput: "INACTIVE50", now: new Date("2026-06-01") },
  { name: "15 empty cart", cart: [], codeInput: "SPRING10", now: new Date("2026-06-01") },
  {
    name: "16 multi-use second time",
    seed: [{ id: "seed", codeId: "c_multi", userId: "u1", orderId: "old", discountAmount: 100, subtotal: 1000, currency: "USD", redeemedAtUtc: new Date("2026-05-01") }],
    cart: [usd(1000, 1)], codeInput: "MULTI10", now: new Date("2026-06-01"),
  },
  { name: "17 not authenticated", cart: [usd(2000, 2)], codeInput: "SPRING10", now: new Date("2026-06-01"), userId: "" },
];

let disagreements = 0;

async function main() {
  console.log("scenario | B2 | C1 | agree");
  for (const s of scenarios) {
    const userId = s.userId === undefined ? "u1" : s.userId;
    const storeB = makeStore(ALL, s.seed);
    const b2 = createDiscountService(b2Repo(storeB));
    const storeC = makeStore(ALL, s.seed);
    const c1 = createApplyDiscountCode(c1Db(storeC));

    const b = normalize(await b2(userId, s.cart, s.codeInput, s.now, "o"));
    const c = normalize(await c1(userId, s.cart, s.codeInput, s.now, "o"));

    const agree = JSON.stringify(b) === JSON.stringify(c);
    if (!agree) disagreements++;
    console.log(`${s.name} | ${JSON.stringify(b)} | ${JSON.stringify(c)} | ${agree ? "yes" : "NO"}`);
  }

  // Concurrent double-submit of a one-use code.
  console.log("\nconcurrent double-submit (one-use code, same user):");
  const storeB = makeStore(ALL);
  const b2 = createDiscountService(b2Repo(storeB));
  const rb = await Promise.all([
    b2("u1", [usd(4000, 1)], "SPRING10", new Date("2026-06-01"), "o1"),
    b2("u1", [usd(4000, 1)], "SPRING10", new Date("2026-06-01"), "o2"),
  ]);
  const storeC = makeStore(ALL);
  const c1 = createApplyDiscountCode(c1Db(storeC));
  const rc = await Promise.all([
    c1("u1", [usd(4000, 1)], "SPRING10", new Date("2026-06-01"), "o1"),
    c1("u1", [usd(4000, 1)], "SPRING10", new Date("2026-06-01"), "o2"),
  ]);
  const nb = rb.map(normalize).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const nc = rc.map(normalize).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  console.log(`B2 concurrent -> ${JSON.stringify(nb)}`);
  console.log(`C1 concurrent -> ${JSON.stringify(nc)}`);
  const agree = JSON.stringify(nb) === JSON.stringify(nc);
  if (!agree) disagreements++;
  console.log(`concurrent agree -> ${agree ? "yes" : "NO"}`);

  console.log(`\n${disagreements} disagreement(s) across ${scenarios.length + 1} inputs`);
  process.exitCode = disagreements ? 1 : 0;
}

main();
