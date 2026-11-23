#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, Map, String, Symbol,
    symbol_short,
};

// ── Error codes ───────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The payment ID was not found in storage.
    NotFound = 1,
    /// The asset code is not in the accepted asset whitelist.
    UnknownAsset = 2,
    /// The USDC issuer does not match the canonical issuer for this network.
    InvalidIssuer = 3,
    /// The escrow has already been released or is in a terminal state.
    AlreadySettled = 4,
    /// Caller is not the contract admin.
    Unauthorized = 5,
    /// Contract has not been initialised yet.
    NotInitialized = 6,
}

// ── Storage key types ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    AcceptedAssets,
    Escrow(String),
}

// ── Asset entry stored in whitelist ──────────────────────────────────────────

/// An accepted (asset_code, issuer) pair.
/// `issuer` is `None` for native XLM and must be the canonical Circle/Centre
/// issuer address for USDC.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetEntry {
    pub asset_code: String,
    /// None for native XLM; Some(canonical_issuer) for credit assets.
    pub asset_issuer: Option<Address>,
}

// ── Escrow record ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct EscrowRecord {
    pub payment_id:  String,
    pub payer:       Address,
    pub beneficiary: Address,
    pub amount:      i128,
    pub asset_code:  String,
    pub released:    bool,
    pub disputed:    bool,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentRegistry;

#[contractimpl]
impl PaymentRegistry {

    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin and the initial accepted asset
    /// whitelist. Must be called exactly once after deployment.
    pub fn initialize(
        env: Env,
        admin: Address,
        initial_assets: Map<String, AssetEntry>,
    ) -> Result<(), Error> {
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadySettled); // already initialised
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AcceptedAssets, &initial_assets);
        Ok(())
    }

    // ── Admin rotation ────────────────────────────────────────────────────────

    /// Rotate the contract admin key. Only the current admin may call this.
    /// Enables migration to a governance multisig without redeployment.
    pub fn rotate_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let current: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        current.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    // ── Asset whitelist governance ────────────────────────────────────────────

    /// Add or replace an accepted (asset_code, issuer) pair. Admin only.
    pub fn add_accepted_asset(env: Env, entry: AssetEntry) -> Result<(), Error> {
        Self::require_admin(&env)?;

        let mut assets: Map<String, AssetEntry> = env.storage().instance()
            .get(&DataKey::AcceptedAssets)
            .unwrap_or_else(|| Map::new(&env));

        assets.set(entry.asset_code.clone(), entry);
        env.storage().instance().set(&DataKey::AcceptedAssets, &assets);
        Ok(())
    }

    /// Remove an accepted asset from the whitelist. Admin only.
    pub fn remove_accepted_asset(env: Env, asset_code: String) -> Result<(), Error> {
        Self::require_admin(&env)?;

        let mut assets: Map<String, AssetEntry> = env.storage().instance()
            .get(&DataKey::AcceptedAssets)
            .unwrap_or_else(|| Map::new(&env));

        assets.remove(asset_code);
        env.storage().instance().set(&DataKey::AcceptedAssets, &assets);
        Ok(())
    }

    // ── Escrow creation ───────────────────────────────────────────────────────

    /// Record a new payment escrow after validating the asset against the
    /// whitelist. For USDC, `asset_issuer` must exactly match the whitelisted
    /// canonical Centre/Circle issuer. For native XLM, `asset_issuer` must be
    /// `None`. Any other combination returns `UnknownAsset` or `InvalidIssuer`.
    pub fn create_escrow(
        env: Env,
        payment_id: String,
        payer: Address,
        beneficiary: Address,
        amount: i128,
        asset_code: String,
        asset_issuer: Option<Address>,
    ) -> Result<(), Error> {
        payer.require_auth();

        // Validate asset and issuer before any state mutation.
        Self::validate_asset(&env, &asset_code, &asset_issuer)?;

        let record = EscrowRecord {
            payment_id: payment_id.clone(),
            payer,
            beneficiary,
            amount,
            asset_code,
            released: false,
            disputed: false,
        };

        env.storage().persistent().set(&DataKey::Escrow(payment_id.clone()), &record);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("created")),
            (payment_id, record.amount),
        );

        Ok(())
    }

    // ── Escrow release ────────────────────────────────────────────────────────

    /// Release escrowed funds to the beneficiary. `ledger_hash` is the hash of
    /// the ledger that included the payment transaction, used for audit linkage.
    pub fn release_escrow(
        env: Env,
        payment_id: String,
        ledger_hash: String,
    ) -> Result<(), Error> {
        let mut record: EscrowRecord = env.storage().persistent()
            .get(&DataKey::Escrow(payment_id.clone()))
            .ok_or(Error::NotFound)?;

        if record.released {
            return Err(Error::AlreadySettled);
        }

        record.beneficiary.require_auth();
        record.released = true;
        env.storage().persistent().set(&DataKey::Escrow(payment_id.clone()), &record);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("released")),
            (payment_id, record.amount, ledger_hash),
        );

        Ok(())
    }

    // ── Dispute ───────────────────────────────────────────────────────────────

    /// Open a dispute on an active escrow. Payer only. Blocks release until
    /// the admin resolves the dispute.
    pub fn dispute_escrow(env: Env, payment_id: String) -> Result<(), Error> {
        let mut record: EscrowRecord = env.storage().persistent()
            .get(&DataKey::Escrow(payment_id.clone()))
            .ok_or(Error::NotFound)?;

        if record.released {
            return Err(Error::AlreadySettled);
        }

        record.payer.require_auth();
        record.disputed = true;
        env.storage().persistent().set(&DataKey::Escrow(payment_id.clone()), &record);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("disputed")),
            (payment_id,),
        );

        Ok(())
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Result<(), Error> {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }

    /// Validate that the asset code is whitelisted and that the provided issuer
    /// matches the stored canonical issuer for that asset.
    fn validate_asset(
        env: &Env,
        asset_code: &String,
        asset_issuer: &Option<Address>,
    ) -> Result<(), Error> {
        let assets: Map<String, AssetEntry> = env.storage().instance()
            .get(&DataKey::AcceptedAssets)
            .ok_or(Error::UnknownAsset)?;

        let entry = assets.get(asset_code.clone())
            .ok_or(Error::UnknownAsset)?;

        // Native XLM: no issuer on-chain; reject any spurious issuer.
        if entry.asset_issuer.is_none() {
            if asset_issuer.is_some() {
                return Err(Error::InvalidIssuer);
            }
            return Ok(());
        }

        // Credit asset (USDC): on-chain issuer must match the whitelisted
        // canonical Centre/Circle issuer exactly.
        match (asset_issuer, &entry.asset_issuer) {
            (Some(provided), Some(expected)) if provided == expected => Ok(()),
            _ => Err(Error::InvalidIssuer),
        }
    }
}
