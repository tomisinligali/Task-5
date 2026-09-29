# C4 — The Explanation Test (speaking notes + non-coder check)

Five-minute script. Say it in plain English, no code on screen, using only the
B1 pseudocode as notes. Target timings in brackets.

## Opening [0:00–0:30]

"I built a discount-code checker for checkout. A customer types a code, and the
feature either works out the discount or tells them exactly why the code can't be
used. It runs through a fixed list of checks in order and stops at the first one
that fails."

## The happy path [0:30–2:30]

Walk through one normal example: a cart of two items at 2000 each, code
`SPRING10` (10% off, minimum spend 3000).

"First it makes sure the cart is real: it isn't empty, every quantity is a whole
number of at least one, every price is zero or more, and everything is in one
currency. Then it adds the cart up — here, 4000.

Next it tidies what the customer typed: trims spaces and uppercases it, so
'spring10' matches 'SPRING10'. Then it looks the code up and confirms it exists
and is switched on.

Then it checks the clock — the code has to have started and not expired. Then it
checks the minimum spend. This one needs 3000, and we have 4000, so it passes. If
the code were a fixed amount instead of a percentage, it would also check the
currency matches.

Then it checks the customer hasn't used this code before, and that the code isn't
used up for everyone.

Now the maths: for a percentage it takes 10% and rounds down; for a fixed code it
takes the set amount. Either way the discount is capped so it can never be bigger
than the cart — the total can't go negative. Here: 400 off, 3600 to pay.

Finally, in one safe step, it re-checks the two limits and saves the redemption,
so if someone double-clicks, only one attempt can win. It hands back the subtotal,
the discount, the new total, and a receipt id."

## Where it can fail, and what happens [2:30–4:30]

Say these in order — the first failing check wins:

1. Not signed in → asks them to sign in.
2. Empty cart, negative/zero quantity, bad price, or mixed currencies → "invalid cart" and stops.
3. No code typed → asks for a code.
4. Code unknown or switched off → "that code isn't valid" (same message for both, so people can't fish for codes).
5. Code starts in the future → "not active yet."
6. Code past its expiry → "expired."
7. Cart below the code's minimum → "spend X more" (it reports the shortfall).
8. Fixed code in the wrong currency → "wrong currency."
9. This customer already used it → "already used."
10. The code is fully redeemed → "fully redeemed."
11. A race: two attempts at once and only one slot → the loser gets "duplicate."

"Throughout, the money is kept in whole cents, so there's no rounding drift, and
the discount can never exceed the cart."

## Closing [4:30–5:00]

"The one rule to remember: it checks a code's rules in a fixed order, it only ever
writes a redemption once, and it never lets the discount push the total below
zero."

## Non-coder check

After recording, show it to someone who doesn't code and ask: "What does this
feature do?"

- Pass if they say something like: "It checks a coupon's rules and applies the
  discount, or explains why the coupon can't be used."
- If they can't, the weak spot is either the script or the pseudocode, not the
  code. The usual culprits: unexplained terms ("subtotal", "redemption") or the
  check order not being stated clearly.

Record their answer and whether it matched. If it didn't, note which term or step
confused them.
