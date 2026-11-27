# PaymentRegistry specification

## Scope and state

The deployed Wasm described here is built from [src/lib.rs](src/lib.rs).
The registry stores attestations. Stellar payment operations move funds
outside the registry. Registration neither reads Stellar transaction history
nor proves settlement.

Let A be the optional admin, P the map from student symbols to ordered
record vectors, T the map from transaction key symbols to records, and C
the unsigned 32-bit count. Missing maps are empty and a missing count is
zero. These values occupy contract instance storage. Each record contains
a student symbol, an i128 amount in the asset's smallest unit, an asset
symbol, the registration ledger sequence, and the supplied transaction key.
The client convention is to use a short hash prefix as the key.

## Entry points

Signatures omit the host-provided Env argument. Read methods leave all
state unchanged. Failed invocations roll back their state writes.

| Entry point | Preconditions | Successful result and state transition | Failure |
| --- | --- | --- | --- |
| `initialize(admin: Address)` | A is absent. No admin authorization is requested by this function. | Sets A to the argument. P, T and C are unchanged. | Reinitialization panics without a custom error code. |
| `register_payment(admin: Address, student_id: Symbol, amount_stroops: i128, asset: Symbol, tx_hash_short: Symbol) -> Result<u32, Error>` | Host authorization for admin, A exists and matches admin, amount > 0, student symbol differs from `___`, transaction key absent from T, count can increment. | Appends one record to P for that student, sets T at the key to the identical record, increments C and returns the new C. The record captures the current ledger sequence. | Host authorization failure, NotInitialized (6), Unauthorized (1), InvalidAmount (4), InvalidStudentId (3), DuplicatePayment (2), or a host/trap failure. |
| `get_payments(student_id: Symbol) -> Result<Vec<PaymentRecord>, Error>` | A vector exists at the given student key. | Returns the vector in registration order. | NoPaymentsFound (5) when the key is absent. |
| `get_payment_by_tx(tx_hash_short: Symbol) -> Option<PaymentRecord>` | None. | Returns the matching record or None. | Host failures can interrupt the read. |
| `get_total_count() -> u32` | None. | Returns C, including zero before the first registration. | Host failures can interrupt the read. |
| `get_admin() -> Option<Address>` | None. | Returns A or None. | Host failures can interrupt the read. |

The contract publishes no custom events. It accepts any host-valid asset
symbol and relies on the client to choose supported asset codes and construct
the transaction key.

## Security invariants

For every successful transition of a live instance under this Wasm:

1. Once A is set, A remains equal to the original initialized address.
2. Changes to P, T or C require a host-authorized registration whose admin
   argument equals A.
3. Each existing record remains byte-for-byte unchanged and in the same
   position in its student vector. Each successful registration appends
   exactly one record.
4. Each record occurs exactly once in P and exactly once in T. Its P key
   equals its student symbol and its T key equals its transaction symbol.
5. C equals both the number of keys in T and the sum of the lengths of all
   vectors in P. A successful registration advances C by one.
6. Every stored amount is positive, every student key differs from `___`,
   and every new record's ledger sequence equals the registration ledger.
7. Failed registrations cannot leave partial records or change C.

The release profile enables overflow checks for the count increment. An
increment beyond u32::MAX traps and the transaction rolls back. There is no
running amount sum in the contract. The contract has no escrow records,
custody entry points or release events. The aggregate escrow liability
created by the registry is zero.

## Threat model and deployment

- An untrusted invoker can read all public registry data. Student symbols
  should be opaque. An invoker cannot register without the stored admin's
  authorization. Before initialization, any invoker can claim the admin
  slot. Deploy and initialize in an atomic transaction and verify A before
  accepting production traffic.
- The admin is trusted to verify payment finality, asset and issuer,
  recipient, amount and student association off chain. A malicious or
  compromised admin can permanently register false attestations and reserve
  keys. Use a controlled authorization account and reconcile with Stellar.
- Replaying the same transaction key after a successful registration fails
  even across students. A short key collision can also reject a legitimate
  payment. Submitting the same transfer under a different key is possible
  for an authorized admin. Consumers should reconcile against full hashes.
- The host enforces encoded integer bounds. The contract rejects
  nonpositive i128 values and traps on counter overflow in release builds.
  Instance storage limits and TTL affect availability as the registry grows.
  Operational monitoring must cover both constraints.

## Upgrade policy

This Wasm exposes no admin rotation or in-place upgrade entry point.
A replacement requires deploying and initializing another instance, then
switching consumers to the new contract ID. The release operator controls
that switch off chain and should publish the new ID, migration and
reconciliation procedure, and activation date. No notice period is enforced
by the contract. A production owner must approve the operational notice
period before adopting a replacement.

## Evidence and review status

- Invariants 1–6 map to initialization, authorization, registration,
  duplicate-key and amount tests in [the Rust source](src/lib.rs).
  Counter overflow and rollback at the limit need dedicated coverage.
- [Authorization property tests](../../tests/contractAuthorizationProperty.test.js)
  exercise backend authorization policy. [Payment API contract tests](../../tests/contract/payment.contract.test.js)
  exercise API-level amount, asset and hash validation. Both are
  complementary to direct execution of the registry Wasm.
- Independent smart contract security review is pending.
