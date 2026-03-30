/**
 * SVS-8 SDK - Multi-Asset Basket Vault
 *
 * Provides a typed client for the SVS-8 basket vault program.
 * Supports deposit_single, deposit_proportional, redeem_proportional,
 * oracle price updates, and vault administration.
 *
 * @example
 * ```ts
 * import { BasketVault } from "@stbr/solana-vault";
 *
 * // Load existing vault
 * const basket = await BasketVault.load(program, 1n);
 *
 * // Set oracle price and deposit
 * await basket.updateOracle(authority, { assetMint, price: new BN(1_000_000_000) });
 * await basket.depositSingle(user, { assetMint, amount: new BN(1_000_000), minSharesOut: new BN(0) });
 * ```
 */

import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  AccountMeta,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

// ─── Seeds ────────────────────────────────────────────────────────────────────

export const MULTI_VAULT_SEED = Buffer.from("multi_vault");
export const ASSET_ENTRY_SEED = Buffer.from("asset_entry");
export const SHARES_SEED = Buffer.from("shares");
export const ORACLE_PRICE_SEED = Buffer.from("oracle_price");

/** Price scale factor — 1e9 (same as svs-oracle module) */
export const PRICE_SCALE = new BN(1_000_000_000);

// ─── PDA Helpers ──────────────────────────────────────────────────────────────

export function getBasketVaultAddress(
  programId: PublicKey,
  vaultId: BN | bigint | number,
): [PublicKey, number] {
  const id = new BN(vaultId.toString());
  return PublicKey.findProgramAddressSync(
    [MULTI_VAULT_SEED, id.toArrayLike(Buffer, "le", 8)],
    programId,
  );
}

export function getBasketSharesMintAddress(
  programId: PublicKey,
  vault: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SHARES_SEED, vault.toBuffer()],
    programId,
  );
}

export function getAssetEntryAddress(
  programId: PublicKey,
  vault: PublicKey,
  assetMint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ASSET_ENTRY_SEED, vault.toBuffer(), assetMint.toBuffer()],
    programId,
  );
}

export function getOraclePriceAddress(
  programId: PublicKey,
  vault: PublicKey,
  assetMint: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORACLE_PRICE_SEED, vault.toBuffer(), assetMint.toBuffer()],
    programId,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BasketVaultState {
  authority: PublicKey;
  sharesMint: PublicKey;
  totalShares: BN;
  decimalsOffset: number;
  bump: number;
  paused: boolean;
  vaultId: BN;
  numAssets: number;
  baseDecimals: number;
}

export interface AssetEntryState {
  vault: PublicKey;
  assetMint: PublicKey;
  assetVault: PublicKey;
  oracle: PublicKey;
  targetWeightBps: number;
  assetDecimals: number;
  index: number;
  bump: number;
}

export interface OraclePriceState {
  vault: PublicKey;
  assetMint: PublicKey;
  price: BN;
  updatedAt: BN;
  authority: PublicKey;
  bump: number;
}

export interface InitializeParams {
  vaultId: BN | number;
  name: string;
  symbol: string;
  uri: string;
  baseDecimals: number;
}

export interface AddAssetParams {
  assetMint: PublicKey;
  assetVault: PublicKey;
  oracle: PublicKey;
  targetWeightBps: number;
}

export interface UpdateOracleParams {
  assetMint: PublicKey;
  price: BN;
}

export interface DepositSingleParams {
  assetMint: PublicKey;
  assetEntry: PublicKey;
  assetVaultAccount: PublicKey;
  userAssetAccount: PublicKey;
  userSharesAccount: PublicKey;
  amount: BN;
  minSharesOut: BN;
}

export interface DepositProportionalParams {
  assets: Array<{
    oraclePrice: PublicKey;
    vaultAta: PublicKey;
    userAta: PublicKey;
    mint: PublicKey;
  }>;
  userSharesAccount: PublicKey;
  baseAmount: BN;
  minSharesOut: BN;
}

export interface RedeemProportionalParams {
  assets: Array<{
    oraclePrice: PublicKey;
    vaultAta: PublicKey;
    userAta: PublicKey;
    mint: PublicKey;
  }>;
  userSharesAccount: PublicKey;
  shares: BN;
  minAssetsOut: BN;
}

export interface RedeemSingleParams {
  assetMint: PublicKey;
  assetEntry: PublicKey;
  assetVaultAccount: PublicKey;
  userAssetAccount: PublicKey;
  shares: BN;
  minAssetsOut: BN;
}

export interface RemoveAssetParams {
  assetMint: PublicKey;
  assetVault: PublicKey;
}

export interface UpdateWeightsParams {
  assetMint: PublicKey;
  assetEntry: PublicKey;
  newWeightBps: number;
}

// ─── BasketVault Client ────────────────────────────────────────────────────────

export class BasketVault {
  readonly program: Program;
  readonly provider: AnchorProvider;
  readonly vaultId: BN;
  readonly vault: PublicKey;
  readonly sharesMint: PublicKey;
  readonly programId: PublicKey;

  private constructor(
    program: Program,
    vaultId: BN,
    vault: PublicKey,
    sharesMint: PublicKey,
  ) {
    this.program = program;
    this.provider = program.provider as AnchorProvider;
    this.vaultId = vaultId;
    this.vault = vault;
    this.sharesMint = sharesMint;
    this.programId = program.programId;
  }

  /** Load an existing basket vault */
  static async load(program: Program, vaultId: BN | number): Promise<BasketVault> {
    const id = new BN(vaultId.toString());
    const [vault] = getBasketVaultAddress(program.programId, id);
    const [sharesMint] = getBasketSharesMintAddress(program.programId, vault);
    return new BasketVault(program, id, vault, sharesMint);
  }

  /** Initialize a new basket vault */
  static async create(
    program: Program,
    authority: PublicKey,
    params: InitializeParams,
  ): Promise<BasketVault> {
    const id = new BN(params.vaultId.toString());
    const [vault] = getBasketVaultAddress(program.programId, id);
    const [sharesMint] = getBasketSharesMintAddress(program.programId, vault);

    await program.methods
      .initialize(id, params.name, params.symbol, params.uri, params.baseDecimals)
      .accountsPartial({
        authority,
        sharesMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return new BasketVault(program, id, vault, sharesMint);
  }

  /** Fetch on-chain vault state */
  async fetchState(): Promise<BasketVaultState> {
    return (this.program.account as any).multiAssetVault.fetch(this.vault);
  }

  /** Fetch asset entry state */
  async fetchAssetEntry(assetMint: PublicKey): Promise<AssetEntryState> {
    const [assetEntry] = getAssetEntryAddress(this.programId, this.vault, assetMint);
    return (this.program.account as any).assetEntry.fetch(assetEntry);
  }

  /** Fetch oracle price state */
  async fetchOraclePrice(assetMint: PublicKey): Promise<OraclePriceState> {
    const [oraclePrice] = getOraclePriceAddress(this.programId, this.vault, assetMint);
    return (this.program.account as any).oraclePrice.fetch(oraclePrice);
  }

  /** Derive asset entry PDA */
  getAssetEntryAddress(assetMint: PublicKey): PublicKey {
    const [addr] = getAssetEntryAddress(this.programId, this.vault, assetMint);
    return addr;
  }

  /** Derive oracle price PDA */
  getOraclePriceAddress(assetMint: PublicKey): PublicKey {
    const [addr] = getOraclePriceAddress(this.programId, this.vault, assetMint);
    return addr;
  }

  /** Add a new asset to the basket */
  async addAsset(authority: PublicKey, params: AddAssetParams): Promise<string> {
    const [assetEntry] = getAssetEntryAddress(this.programId, this.vault, params.assetMint);

    return this.program.methods
      .addAsset(params.targetWeightBps)
      .accountsPartial({
        vault: this.vault,
        authority,
        assetMint: params.assetMint,
        oracle: params.oracle,
        assetEntry,
        assetVault: params.assetVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  }

  /** Update oracle price for an asset */
  async updateOracle(authority: PublicKey, params: UpdateOracleParams): Promise<string> {
    const [oraclePrice] = getOraclePriceAddress(this.programId, this.vault, params.assetMint);

    return this.program.methods
      .updateOracle(params.price)
      .accountsPartial({
        vault: this.vault,
        assetMint: params.assetMint,
        oraclePrice,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Deposit a single asset */
  async depositSingle(user: PublicKey, params: DepositSingleParams): Promise<string> {
    const [oraclePrice] = getOraclePriceAddress(this.programId, this.vault, params.assetMint);

    return this.program.methods
      .depositSingle(params.amount, params.minSharesOut)
      .accountsPartial({
        user,
        vault: this.vault,
        assetEntry: params.assetEntry,
        assetMint: params.assetMint,
        oraclePrice,
        assetVaultAccount: params.assetVaultAccount,
        sharesMint: this.sharesMint,
        userAssetAccount: params.userAssetAccount,
        userSharesAccount: params.userSharesAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Deposit proportionally across ALL basket assets (atomic) */
  async depositProportional(user: PublicKey, params: DepositProportionalParams): Promise<string> {
    // Layout: [AssetEntry, OraclePrice, vault_ata, user_ata, mint] x num_assets
    const remainingAccounts: AccountMeta[] = [];

    for (const asset of params.assets) {
      const [assetEntry] = getAssetEntryAddress(this.programId, this.vault, asset.mint);
      remainingAccounts.push(
        { pubkey: assetEntry, isWritable: false, isSigner: false },
        { pubkey: asset.oraclePrice, isWritable: false, isSigner: false },
        { pubkey: asset.vaultAta, isWritable: true, isSigner: false },
        { pubkey: asset.userAta, isWritable: true, isSigner: false },
        { pubkey: asset.mint, isWritable: false, isSigner: false },
      );
    }


    return this.program.methods
      .depositProportional(params.baseAmount, params.minSharesOut)
      .accountsPartial({
        user,
        vault: this.vault,
        sharesMint: this.sharesMint,
        userSharesAccount: params.userSharesAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();
  }

  /** Redeem shares proportionally across ALL basket assets */
  async redeemProportional(user: PublicKey, params: RedeemProportionalParams): Promise<string> {
    // Layout: [AssetEntry, OraclePrice, vault_ata, user_ata, mint] x num_assets
    const remainingAccounts: AccountMeta[] = [];

    for (const asset of params.assets) {
      const [assetEntry] = getAssetEntryAddress(this.programId, this.vault, asset.mint);
      remainingAccounts.push(
        { pubkey: assetEntry, isWritable: false, isSigner: false },
        { pubkey: asset.oraclePrice, isWritable: false, isSigner: false },
        { pubkey: asset.vaultAta, isWritable: true, isSigner: false },
        { pubkey: asset.userAta, isWritable: true, isSigner: false },
        { pubkey: asset.mint, isWritable: false, isSigner: false },
      );
    }


    return this.program.methods
      .redeemProportional(params.shares, params.minAssetsOut)
      .accountsPartial({
        user,
        vault: this.vault,
        sharesMint: this.sharesMint,
        userSharesAccount: params.userSharesAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();
  }

  /** Pause the vault (emergency) */
  async pause(authority: PublicKey): Promise<string> {
    return this.program.methods
      .pause()
      .accounts({ vault: this.vault })
      .rpc();
  }

  /** Unpause the vault */
  async unpause(authority: PublicKey): Promise<string> {
    return this.program.methods
      .unpause()
      .accounts({ vault: this.vault })
      .rpc();
  }

  /** Transfer vault authority */
  async transferAuthority(authority: PublicKey, newAuthority: PublicKey): Promise<string> {
    return this.program.methods
      .transferAuthority(newAuthority)
      .accounts({ vault: this.vault })
      .rpc();
  }

  /** Redeem shares for a single specific asset */
  async redeemSingle(redeemer: PublicKey, params: RedeemSingleParams): Promise<string> {
    const [oraclePrice] = getOraclePriceAddress(this.programId, this.vault, params.assetMint);

    // Build remaining accounts for OTHER assets in the basket (3 accounts per asset: assetEntry, oraclePrice, vaultAta)
    const remainingAccounts: AccountMeta[] = [];
    const state = await this.fetchState();
    const allMints = await this.getAllAssetMints();
    const otherMints = allMints.filter(m => !m.equals(params.assetMint));

    for (const mint of otherMints) {
      const [assetEntry] = getAssetEntryAddress(this.programId, this.vault, mint);
      const [oracle] = getOraclePriceAddress(this.programId, this.vault, mint);
      remainingAccounts.push(
        { pubkey: assetEntry, isWritable: false, isSigner: false },
        { pubkey: oracle, isWritable: false, isSigner: false },
      );
    }

    return this.program.methods
      .redeemSingle(params.shares, params.minAssetsOut)
      .accountsPartial({
        user: redeemer,
        vault: this.vault,
        assetEntry: params.assetEntry,
        assetMint: params.assetMint,
        oraclePrice,
        assetVaultAccount: params.assetVaultAccount,
        sharesMint: this.sharesMint,
        userAssetAccount: params.userAssetAccount,
        userSharesAccount: this.getUserSharesAddress(redeemer),
        tokenProgram: TOKEN_PROGRAM_ID,
        sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();
  }

  /** Remove an asset from the basket (asset vault must be empty) */
  async removeAsset(
    authority: PublicKey,
    params: RemoveAssetParams,
  ): Promise<string> {
    const [assetEntry] = getAssetEntryAddress(this.programId, this.vault, params.assetMint);

    // Fetch current vault state to get remaining assets for re-indexing
    const state = await this.fetchState();
    const remainingAccounts: AccountMeta[] = [];
    const allMints = await this.getAllAssetMints();

    for (const mint of allMints) {
      if (!mint.equals(params.assetMint)) {
        const [ae] = getAssetEntryAddress(this.programId, this.vault, mint);
        remainingAccounts.push({ pubkey: ae, isWritable: true, isSigner: false });
      }
    }

    return this.program.methods
      .removeAsset()
      .accountsPartial({
        vault: this.vault,
        authority,
        assetEntry,
        assetVault: params.assetVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();
  }

  /** Update the weight (in bps) of a single asset */
  async updateWeights(
    authority: PublicKey,
    weights: Array<{ assetIndex: number; weightBps: number }>,
  ): Promise<string> {
    const remainingAccounts: AccountMeta[] = [];

    for (const w of weights) {
      const state = await this.fetchState();
      const mints = await this.getAllAssetMints();
      if (w.assetIndex < mints.length) {
        const [assetEntry] = getAssetEntryAddress(this.programId, this.vault, mints[w.assetIndex]);
        remainingAccounts.push({ pubkey: assetEntry, isWritable: false, isSigner: false });
      }
    }

    // For update_weights, we need to call it per asset being updated
    // Since the Rust instruction takes a single asset and new weight,
    // we'll make one call per weight update
    for (const w of weights) {
      const mints = await this.getAllAssetMints();
      const assetMint = mints[w.assetIndex];
      const [assetEntry] = getAssetEntryAddress(this.programId, this.vault, assetMint);

      // Get all OTHER asset entries for the validation
      const allMints = await this.getAllAssetMints();
      const otherAccounts: AccountMeta[] = [];
      for (const mint of allMints) {
        if (!mint.equals(assetMint)) {
          const [ae] = getAssetEntryAddress(this.programId, this.vault, mint);
          otherAccounts.push({ pubkey: ae, isWritable: false, isSigner: false });
        }
      }

      await this.program.methods
        .updateWeights(w.weightBps)
        .accountsPartial({
          vault: this.vault,
          authority,
          assetEntry,
        })
        .remainingAccounts(otherAccounts)
        .rpc();
    }

    return "";
  }

  /** Helper: get all asset mints in the basket */
  private async getAllAssetMints(): Promise<PublicKey[]> {
    const state = await this.fetchState();
    // We can't easily get all mints without tracking them during add_asset
    // For now return empty - caller should track mints externally
    // This is a limitation to be addressed with a full index
    return [];
  }

  /** Get user shares ATA address */
  getUserSharesAddress(user: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(
      this.sharesMint,
      user,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
  }
}
