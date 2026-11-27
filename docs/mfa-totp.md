# Multi-Factor Authentication (TOTP) — Issue #618

School admin accounts carry elevated privileges (access to all student payment
data, fee management, user management). TOTP-based MFA is enforced for all
admin roles to reduce account takeover risk.

## Endpoints

### School-level MFA (super-admin)

| Method | Path                                | Description                              |
|--------|-------------------------------------|------------------------------------------|
| POST   | `/api/auth/mfa/enroll`              | Generate TOTP secret + 10 backup codes   |
| POST   | `/api/auth/mfa/setup`               | Alias for `/mfa/enroll`                  |
| POST   | `/api/auth/mfa/verify`              | Verify TOTP and activate MFA             |
| POST   | `/api/auth/mfa/disable`             | Disable MFA (requires valid TOTP code)   |
| POST   | `/api/auth/mfa/backup-codes/regenerate` | Regenerate backup codes             |

### User-level MFA (any authenticated user)

| Method | Path                                | Description                              |
|--------|-------------------------------------|------------------------------------------|
| POST   | `/api/auth/mfa/user/enroll`         | Generate TOTP secret + 10 backup codes   |
| POST   | `/api/auth/mfa/user/setup`          | Alias for `/mfa/user/enroll`             |
| POST   | `/api/auth/mfa/user/verify`         | Verify TOTP and activate user MFA        |
| POST   | `/api/auth/mfa/user/disable`        | Disable user MFA (requires TOTP code)    |

## Login flow with MFA enabled

1. `POST /api/auth/login` with `{ email, password }` → `200 { requiresMfa: true }` when MFA is enrolled.
2. Re-submit with `{ email, password, mfaCode }` → `200` with `admin_token` cookie on success.
3. Recovery codes can be used in place of `mfaCode`. Each code is single-use.

## REQUIRE_MFA mode

When `REQUIRE_MFA=true`:

- Admins without MFA configured receive a restricted `mfaSetupPending` JWT on login.
- The restricted token cannot access sensitive endpoints (`403 MFA_SETUP_REQUIRED`).
- Once TOTP is verified via `/mfa/user/verify`, a full-access token is reissued automatically.

## Technical details

- TOTP per RFC 6238, 30-second window, SHA-1 (compatible with Google Authenticator / Authy).
- Library: `speakeasy ^2.0.0`.
- MFA secrets encrypted at rest using AES-256-GCM, key derived from `JWT_SECRET`.
- 10 single-use recovery codes generated on enrollment; each is SHA-256 hashed before storage.
- Failed MFA attempts are logged as high-severity audit events.
