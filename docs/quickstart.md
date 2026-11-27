# Developer Quick Start

> **Goal:** From a fresh clone to a running local PaymentFlow environment in under 15 minutes.

This guide targets developers with Node.js and Docker experience. It covers everything the README's Getting Started section summarises — with exact versions, a first-payment walkthrough, a devcontainer option, and a troubleshooting FAQ.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Clone the Repository](#step-1-clone-the-repository)
- [Step 2: Install Dependencies](#step-2-install-dependencies)
- [Step 3: Configure Environment](#step-3-configure-environment)
- [Step 4: Set Up a Stellar Testnet Wallet](#step-4-set-up-a-stellar-testnet-wallet)
- [Step 5: Start the Stack](#step-5-start-the-stack)
- [Step 6: Run Database Migrations](#step-6-run-database-migrations)
- [Step 7: Seed Demo Data](#step-7-seed-demo-data)
- [Step 8: Verify the Setup](#step-8-verify-the-setup)
- [First Payment Walkthrough](#first-payment-walkthrough)
- [VS Code Devcontainer (One-Click Environment)](#vs-code-devcontainer-one-click-environment)
- [Troubleshooting FAQ](#troubleshooting-faq)
- [Useful Commands](#useful-commands)

---

## Prerequisites

Install these before starting. The versions below are tested and pinned.

| Tool | Required Version | Install |
|------|-----------------|---------|
| Git | Any recent | [git-scm.com](https://git-scm.com/) |
| Node.js | **20.11.0** (see `.nvmrc`) | [nodejs.org](https://nodejs.org/en/download) or [nvm](https://github.com/nvm-sh/nvm) |
| npm | 10+ (bundled with Node 20) | Comes with Node |
| Docker Engine | 24+ | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| Docker Compose | **v2** (`docker compose`, not `docker-compose`) | [docs.docker.com/compose/install](https://docs.docker.com/compose/install/) |
| curl | Any | Pre-installed on macOS/Linux |
| openssl | Any | Pre-installed on macOS/Linux |

> **Note:** Rust is **not** required. The Soroban contract layer in this repo is pure JavaScript — no Rust toolchain needed.

Verify your versions before continuing:

```bash
node --version        # v20.x.x
npm --version         # 10.x.x
docker compose version  # Docker Compose version v2.x.x
```

If you have [nvm](https://github.com/nvm-sh/nvm), switching to the right Node version is one command:

```bash
nvm use  # reads .nvmrc → switches to 20.11.0
```

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/onlyonee1/PaymentFlow.git
cd PaymentFlow
```

---

## Step 2: Install Dependencies

Three separate packages need installing: the root (test tooling), the backend, and the frontend.

```bash
npm ci
(cd backend && npm ci)
(cd frontend && npm ci)
```

`npm ci` is preferred over `npm install` — it installs exactly the versions in `package-lock.json` and fails fast on mismatches.

---

## Step 3: Configure Environment

PaymentFlow uses three environment files. They are `.gitignore`-d and must not be committed.

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Generate secrets for the two files you need to edit:

```bash
openssl rand -hex 32   # copy this value — use it for JWT_SECRET
openssl rand -hex 32   # copy this value — use it for METRICS_TOKEN
```

**Edit `.env`** (used by Docker Compose):

```bash
MONGO_ROOT_PASSWORD=any_local_password
JWT_SECRET=<first value from above>
ADMIN_PASSWORD=any_local_password
METRICS_TOKEN=<second value from above>
```

**Edit `backend/.env`** (used when running the backend on the host):

```bash
JWT_SECRET=<same value as above>
ADMIN_PASSWORD=<same value as above>
```

**Leave `frontend/.env.local` as-is.** The default `NEXT_PUBLIC_API_URL=http://localhost:5000/api` works with Docker Compose.

`SCHOOL_WALLET_ADDRESS` is optional for startup. The app starts and returns `degraded` on the health endpoint until a wallet is configured. Set it in Step 4.

---

## Step 4: Set Up a Stellar Testnet Wallet

The backend reads transactions from the Stellar Testnet — it never holds the school's private key. You need a funded testnet wallet address to use as the school wallet.

**Option A — via browser (fastest):**

1. Open [Stellar Laboratory → Keypair Generator](https://laboratory.stellar.org/#account-creator?network=test)
2. Click **Generate keypair**
3. Click **Fund account with Friendbot** (gives the account 10,000 XLM on testnet)
4. Copy the **Public Key** (starts with `G`)
5. Add it to `backend/.env`:

```bash
SCHOOL_WALLET_ADDRESS=GYOUR_PUBLIC_KEY_HERE
```

**Option B — via CLI:**

```bash
cd backend && npm run create-wallet && cd ..
```

This prints a keypair. Copy the public key into `backend/.env` as `SCHOOL_WALLET_ADDRESS`. Then fund the account at [Stellar Friendbot](https://friendbot.stellar.org/?addr=GYOUR_PUBLIC_KEY_HERE).

> **Security:** Never commit the secret key. The backend only needs and uses the public key.

---

## Step 5: Start the Stack

Docker Compose starts MongoDB (as a replica set), Redis, the backend, and the frontend.

```bash
docker compose up --build -d
```

MongoDB requires a brief initialisation period for the replica set. Wait about 20 seconds, then check status:

```bash
docker compose ps
```

All services should show `healthy` or `running`. If the backend shows `starting`, give it another 10–15 seconds and re-check.

Confirm the backend is up:

```bash
curl -s http://localhost:5000/health | jq .
```

Expected output:

```json
{"status": "ok"}
```

A `"degraded"` status is normal if Stellar Horizon is unreachable from your network — MongoDB connectivity determines `"unhealthy"`.

---

## Step 6: Run Database Migrations

```bash
(cd backend && npm run migrate)
```

This applies all migrations in `backend/migrations/` to the running MongoDB instance. It is safe to re-run — each migration is idempotent.

---

## Step 7: Seed Demo Data

```bash
npm run seed
```

This creates a demo school (`SCH001`), demo students, and example payment records. The seed script reads `backend/.env` and connects to MongoDB directly — it requires Step 5 to be complete.

> If the seed script cannot reach MongoDB, run it inside the container instead:
> ```bash
> docker compose exec backend node scripts/seed-test-data.js
> ```

---

## Step 8: Verify the Setup

**Frontend:** Open [http://localhost:3000](http://localhost:3000) in your browser.

**Admin login via API** — replace `<your ADMIN_PASSWORD>` with the value you set in `.env`:

```bash
curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<your ADMIN_PASSWORD>"}' | jq .
```

A successful response includes a `token` field. Copy the token — you need it for the payment walkthrough below.

**Swagger UI** (interactive API docs):

Open [http://localhost:5000/api/docs](http://localhost:5000/api/docs) — available in development mode.

**Smoke tests:**

```bash
node scripts/smoke-tests.js
```

---

## First Payment Walkthrough

This creates a school, a student, and processes a test payment on Stellar Testnet. Replace `<token>` with the JWT from Step 8.

### 1. Create a student

```bash
curl -s -X POST http://localhost:5000/api/students \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{
    "studentId": "STU-DEMO-001",
    "name": "Demo Student",
    "feeAmount": 10,
    "schoolId": "SCH001"
  }' | jq .
```

### 2. Get payment instructions

```bash
curl -s "http://localhost:5000/api/payments/instructions/STU-DEMO-001" | jq .
```

The response includes the school wallet address and memo (`STU-DEMO-001`) to include in the Stellar transaction.

### 3. Send a testnet payment

Using [Stellar Laboratory → Transaction Builder](https://laboratory.stellar.org/#txbuilder?network=test):

1. Set **Source Account** to your testnet keypair (from Step 4)
2. Add a **Payment** operation: destination = school wallet address, asset = XLM, amount = 10
3. Set **Memo** → Text → `STU-DEMO-001`
4. Sign and submit
5. Copy the **transaction hash**

### 4. Verify the payment

```bash
curl -s -X POST http://localhost:5000/api/payments/verify \
  -H 'Content-Type: application/json' \
  -d '{"txHash": "<your_transaction_hash>"}' | jq .
```

### 5. Check the student's payment status

```bash
curl -s "http://localhost:5000/api/students/STU-DEMO-001" \
  -H 'Authorization: Bearer <token>' | jq '.remainingBalance'
```

The balance should reflect the payment. The polling service also picks up the payment automatically on its next cycle (default: every 60 seconds).

---

## VS Code Devcontainer (One-Click Environment)

If you have [VS Code](https://code.visualstudio.com/) and the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers):

1. Open the repo in VS Code
2. When prompted **"Reopen in Container"**, click it — or open the command palette and run **Dev Containers: Reopen in Container**
3. The container builds using `.devcontainer/devcontainer.json`, installs all dependencies, and runs the `postCreateCommand` automatically

No manual `npm ci`, environment file copies, or MongoDB setup needed inside the devcontainer — the configuration handles it. You can skip Steps 2–5 above and go straight to Step 6 (migrations).

---

## Troubleshooting FAQ

| Problem | Cause | Fix |
|---------|-------|-----|
| `connection refused` on port 27017 | MongoDB not started | Run `docker compose up` and confirm `docker compose ps mongo` shows healthy |
| `MongoServerError: Transaction numbers are only allowed on replica set members` | Standalone MongoDB (not replica set) | Use `docker compose up` — the Compose file configures the replica set automatically; do not point the app at a standalone `mongod` |
| Backend shows `unhealthy` in `docker compose ps` | MongoDB not ready yet | Wait 20–30 s for the replica set to initialise, then re-check with `curl http://localhost:5000/health` |
| `JWT_SECRET is required` or similar startup error | Missing env var in `backend/.env` | Confirm `backend/.env` exists and has `JWT_SECRET` set; re-run `cp backend/.env.example backend/.env` if missing |
| `npm ci` fails with peer dependency errors | Node version mismatch | Run `nvm use` in the repo root, or install Node 20.11.0 manually |
| Seed script fails to connect to MongoDB | MongoDB not reachable from host | Run inside the container: `docker compose exec backend node scripts/seed-test-data.js` |
| `op_no_trust` from Stellar | Recipient account has no USDC trustline | Switch `ACCEPTED_ASSET=XLM` in `backend/.env` for local testing |
| `tx_bad_auth` from Stellar | Secret key does not match the public address | Verify `SCHOOL_WALLET_ADDRESS` in `backend/.env` matches the keypair you funded |
| Rate-limit counters reset on restart | Redis not configured | Set `REDIS_HOST=redis` in `backend/.env` (matches the Docker Compose service name) |
| Swagger UI not loading at `/api/docs` | App running in production mode | Set `NODE_ENV=development` or add `SWAGGER_ENABLED=true` to `backend/.env` |
| Frontend cannot reach the API | Wrong `NEXT_PUBLIC_API_URL` or backend not on port 5000 | Keep `NEXT_PUBLIC_API_URL=http://localhost:5000/api` in `frontend/.env.local`; restart the frontend after changes to `NEXT_PUBLIC_*` vars |
| `SCHOOL_WALLET_ADDRESS is invalid` on startup | Invalid or missing public key | Provide a valid Stellar public key (starts with `G`); generate one with `cd backend && npm run create-wallet` |
| `docker compose` command not found | Docker Compose v1 (`docker-compose`) installed | Install [Docker Compose v2](https://docs.docker.com/compose/install/) and use `docker compose` (space, not hyphen) |

---

## Useful Commands

```bash
# Tail backend logs
docker compose logs -f backend

# Restart backend after a code change
docker compose restart backend

# Run backend migrations
(cd backend && npm run migrate)

# Run the full test suite
npm test

# Run backend tests only
(cd backend && npm test)

# Start backend on the host (stop docker compose backend first)
(cd backend && npm run dev)

# Start frontend on the host (stop docker compose frontend first)
(cd frontend && npm run dev)

# Generate a new admin password hash
node scripts/hash-admin-password.js

# Generate a new Stellar keypair (testnet)
(cd backend && npm run create-wallet)
```

---

## Next Steps

- [Stellar Integration Architecture](architecture/stellar-integration.md) — sequence diagrams for the full payment flow
- [Environment Variable Reference](environment-reference.md) — every config knob with defaults
- [API Reference](api-spec.md) — full endpoint documentation
- [Webhook Integration](WEBHOOK_INTEGRATION.md) — set up outbound payment webhooks
- [Contributing Guide](../CONTRIBUTING.md) — coding standards and PR process
