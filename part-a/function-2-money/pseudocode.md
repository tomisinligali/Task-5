FUNCTION resolvePayment

INPUTS:
- userId
- txRef
- transactionId
- rawReturnParams
- source

OUTPUT:
- A ReturnResult describing the payment outcome.

SIDE EFFECTS:
- Reads and writes payment, checkout, subscription, and user records.
- Calls the payment provider to verify the transaction.
- Creates payment logs and subscription events.
- May update the user's plan and subscription.
- May mark the checkout as FAILED or COMPLETED.

FAILS WHEN:
- A required database operation fails.
- A required payment log or subscription event cannot be created.
- Payment-provider verification fails and the failure-handling operations also fail.
- The successful payment transaction fails.
- A post-payment event or final payment log fails.

STEPS:

1. Read the payment source and create a user-scoped database client.

2. Reconcile the user's existing subscription before processing the payment.
   - If the user or subscription does not exist, stop reconciliation.
   - If the subscription period has not ended, stop reconciliation.
   - If the period has ended, apply any scheduled cancellation, resubscription, downgrade, or period renewal.

3. Find the checkout session using txRef.
   - If the checkout session does not exist:
     - Record a failed provider-return log.
     - Return NOT_FOUND.
     - Stop processing.

4. If the checkout session is already COMPLETED:
   - Return ALREADY_COMPLETED.
   - Do not verify the payment again.
   - Stop processing.

5. Validate the optional transactionId and record a payment-verification request.
   - Only accept a non-empty numeric transaction ID.
   - Do not send an invalid transaction ID to the provider.

6. Call the payment provider to verify the transaction.

7. If provider verification fails:
   - Mark the checkout as FAILED.
   - Record an error payment log.
   - Return FAILED.
   - Stop processing.

8. If provider verification succeeds:
   - Record the verified payment status, amount, currency, and provider IDs.

9. If the provider status is PENDING:
   - Return PENDING.
   - Do not activate the plan.
   - Stop processing.

10. If the provider status is not SUCCESSFUL:
    - Mark the checkout as FAILED.
    - Record a failed subscription event.
    - Return FAILED.
    - Stop processing.

11. If the verified amount or currency does not match the checkout:
    - Mark the checkout as FAILED.
    - Record the payment mismatch.
    - Record a failed subscription event.
    - Return FAILED.
    - Stop processing.

12. For a successful matching payment:
    - Determine the plan and subscription period.
    - If the intent is UPGRADE, use the YEARLY plan and a 12-month period.
    - Otherwise use the checkout session's plan.
    - Use one month as the fallback when the plan has no configured month count.

13. Apply the successful payment in one database transaction:
    - Update the user's plan.
    - Create or update the subscription.
    - Set the subscription to ACTIVE with the new period.
    - Mark the checkout as COMPLETED.
    - Store the verified provider IDs.

14. Record the appropriate successful subscription event:
    - UPGRADE → UPGRADE_PAID.
    - RESUBSCRIBE → RESUBSCRIBE_APPLIED.
    - Other intents → PAYMENT_VERIFIED.

15. Record the final successful payment state.

16. Return COMPLETED with the appropriate success message.