/**
 * SVS-8 Basic Script - Full Vault Lifecycle
 *
 * Demonstrates complete basket vault functionality on devnet:
 * - Initialize vault
 * - Add two assets (50/50 split)
 * - Set oracle prices
 * - Deposit single asset
 * - Redeem proportional
 * - Redeem single asset
 * - Update weights
 * - Remove asset (after redeem)
 * - Pause/unpause
 *
 * Run: npx ts-node scripts/svs-8/basic.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount, getMint,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  setupScript, getVaultPDA, getSharesMintPDA, getAssetEntryPDA, getOraclePricePDA,
  explorerUrl, accountUrl, ASSET_DECIMALS, PRICE_SCALE,
} from "./helpers";

async function main() {
  const { connection, payer, program, programId } = await setupScript("Basic Functionality - Full Lifecycle");

  // Step 1: Create test tokens
  console.log("\n" + "-".repeat(70));
  console.log("Step 1: Creating test tokens (Mock USDC + Mock USDT)");
  console.log("-".repeat(70));

  const mintA = await createMint(connection, payer, payer.publicKey, null, ASSET_DECIMALS, Keypair.generate(), undefined, TOKEN_PROGRAM_ID);
  const mintB = await createMint(connection, payer, payer.publicKey, null, ASSET_DECIMALS, Keypair.generate(), undefined, TOKEN_PROGRAM_ID);
  console.log(`  Mint A (Mock USDC): ${mintA.toBase58()}`);
  console.log(`  Mint B (Mock USDT): ${mintB.toBase58()}`);

  // Step 2: Mint tokens to user
  console.log("\n" + "-".repeat(70));
  console.log("Step 2: Minting tokens to user");
  console.log("-".repeat(70));

  const userAtaA = await getOrCreateAssociatedTokenAccount(connection, payer, mintA, payer.publicKey, false, undefined, undefined, TOKEN_PROGRAM_ID);
  const userAtaB = await getOrCreateAssociatedTokenAccount(connection, payer, mintB, payer.publicKey, false, undefined, undefined, TOKEN_PROGRAM_ID);

  await mintTo(connection, payer, mintA, userAtaA.address, payer.publicKey, 10_000_000, [], undefined, TOKEN_PROGRAM_ID);
  await mintTo(connection, payer, mintB, userAtaB.address, payer.publicKey, 10_000_000, [], undefined, TOKEN_PROGRAM_ID);
  console.log(`  Minted 10 tokens of each to ${payer.publicKey.toBase58()}`);

  const balA = await getAccount(connection, userAtaA.address, undefined, TOKEN_PROGRAM_ID);
  const balB = await getAccount(connection, userAtaB.address, undefined, TOKEN_PROGRAM_ID);
  console.log(`  User ATA A balance: ${balA.amount}`);
  console.log(`  User ATA B balance: ${balB.amount}`);

  // Step 3: Derive PDAs
  console.log("\n" + "-".repeat(70));
  console.log("Step 3: Deriving PDAs");
  console.log("-".repeat(70));

  const vaultId = new BN(Date.now());
  const [vaultPda] = getVaultPDA(programId, vaultId);
  const [sharesMint] = getSharesMintPDA(programId, vaultPda);
  const [assetEntryA] = getAssetEntryPDA(programId, vaultPda, mintA);
  const [assetEntryB] = getAssetEntryPDA(programId, vaultPda, mintB);
  const [oraclePriceA] = getOraclePricePDA(programId, vaultPda, mintA);
  const [oraclePriceB] = getOraclePricePDA(programId, vaultPda, mintB);

  console.log(`  Vault PDA: ${accountUrl(vaultPda.toBase58())}`);
  console.log(`  Shares Mint: ${accountUrl(sharesMint.toBase58())}`);
  console.log(`  Asset Entry A: ${accountUrl(assetEntryA.toBase58())}`);
  console.log(`  Asset Entry B: ${accountUrl(assetEntryB.toBase58())}`);

  // Step 4: Initialize vault
  console.log("\n" + "-".repeat(70));
  console.log("Step 4: Initializing vault");
  console.log("-".repeat(70));

  const initTx = await program.methods
    .initialize(vaultId, 6)
    .accountsPartial({
      authority: payer.publicKey,
      sharesMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log(`  ✅ Vault initialized: ${explorerUrl(initTx)}`);

  // Step 5: Add assets
  console.log("\n" + "-".repeat(70));
  console.log("Step 5: Adding assets (50/50 split)");
  console.log("-".repeat(70));

  const assetVaultAKeypair = Keypair.generate();
  const assetVaultBKeypair = Keypair.generate();

  const addATx = await program.methods
    .addAsset(5_000)
    .accountsPartial({
      vault: vaultPda, authority: payer.publicKey, assetMint: mintA,
      oracle: Keypair.generate().publicKey,
      assetEntry: assetEntryA, assetVault: assetVaultAKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([assetVaultAKeypair])
    .rpc();
  console.log(`  ✅ Asset A added: ${explorerUrl(addATx)}`);

  const addBTx = await program.methods
    .addAsset(5_000)
    .accountsPartial({
      vault: vaultPda, authority: payer.publicKey, assetMint: mintB,
      oracle: Keypair.generate().publicKey,
      assetEntry: assetEntryB, assetVault: assetVaultBKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([assetVaultBKeypair])
    .rpc();
  console.log(`  ✅ Asset B added: ${explorerUrl(addBTx)}`);

  const vaultState1 = await program.account.multiAssetVault.fetch(vaultPda);
  console.log(`  Vault num_assets: ${vaultState1.numAssets}`);
  console.log(`  Vault authority: ${vaultState1.authority}`);

  // Step 6: Set oracle prices
  console.log("\n" + "-".repeat(70));
  console.log("Step 6: Setting oracle prices (1.0 USDC each)");
  console.log("-".repeat(70));

  const oracleATx = await program.methods
    .updateOracle(new BN(PRICE_SCALE))
    .accountsPartial({
      vault: vaultPda, assetMint: mintA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ✅ Oracle A set: ${explorerUrl(oracleATx)}`);

  const oracleBTx = await program.methods
    .updateOracle(new BN(PRICE_SCALE))
    .accountsPartial({
      vault: vaultPda, assetMint: mintB,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ✅ Oracle B set: ${explorerUrl(oracleBTx)}`);

  // Step 7: Get shares ATA
  console.log("\n" + "-".repeat(70));
  console.log("Step 7: Getting shares ATA");
  console.log("-".repeat(70));

  const userSharesAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, sharesMint, payer.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID
  );
  console.log(`  User Shares ATA: ${accountUrl(userSharesAta.address.toBase58())}`);

  // Step 8: Deposit single asset A
  console.log("\n" + "-".repeat(70));
  console.log("Step 8: Depositing 1 token of Asset A (single deposit)");
  console.log("-".repeat(70));

  const depositSingleTx = await program.methods
    .depositSingle(new BN(1_000_000), new BN(0))
    .accountsPartial({
      user: payer.publicKey, vault: vaultPda, assetEntry: assetEntryA,
      assetMint: mintA, oraclePrice: oraclePriceA,
      assetVaultAccount: assetVaultAKeypair.publicKey,
      sharesMint, userAssetAccount: userAtaA.address,
      userSharesAccount: userSharesAta.address,
      tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: assetEntryB, isWritable: false, isSigner: false },
      { pubkey: oraclePriceB, isWritable: false, isSigner: false },
      { pubkey: assetVaultBKeypair.publicKey, isWritable: true, isSigner: false },
    ])
    .rpc();
  console.log(`  ✅ Single deposit: ${explorerUrl(depositSingleTx)}`);

  const mintInfo1 = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
  console.log(`  Total shares after single deposit: ${mintInfo1.supply}`);

  const vaultBalA1 = await getAccount(connection, assetVaultAKeypair.publicKey, undefined, TOKEN_PROGRAM_ID);
  console.log(`  Vault A balance: ${vaultBalA1.amount}`);

  // Step 9: Deposit proportional
  console.log("\n" + "-".repeat(70));
  console.log("Step 9: Depositing proportionally (0.5 tokens base)");
  console.log("-".repeat(70));

  const depositPropTx = await program.methods
    .depositProportional(new BN(500_000), new BN(0))
    .accountsPartial({
      user: payer.publicKey, vault: vaultPda, sharesMint,
      userSharesAccount: userSharesAta.address,
      tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      // Asset A: [AssetEntry, OraclePrice, vault_ata, user_ata, mint]
      { pubkey: assetEntryA, isWritable: false, isSigner: false },
      { pubkey: oraclePriceA, isWritable: false, isSigner: false },
      { pubkey: assetVaultAKeypair.publicKey, isWritable: true, isSigner: false },
      { pubkey: userAtaA.address, isWritable: true, isSigner: false },
      { pubkey: mintA, isWritable: false, isSigner: false },
      // Asset B: [AssetEntry, OraclePrice, vault_ata, user_ata, mint]
      { pubkey: assetEntryB, isWritable: false, isSigner: false },
      { pubkey: oraclePriceB, isWritable: false, isSigner: false },
      { pubkey: assetVaultBKeypair.publicKey, isWritable: true, isSigner: false },
      { pubkey: userAtaB.address, isWritable: true, isSigner: false },
      { pubkey: mintB, isWritable: false, isSigner: false },
    ])
    .rpc();
  console.log(`  ✅ Proportional deposit: ${explorerUrl(depositPropTx)}`);

  const mintInfo2 = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
  console.log(`  Total shares after proportional deposit: ${mintInfo2.supply}`);

  // Step 10: Redeem proportional
  console.log("\n" + "-".repeat(70));
  console.log("Step 10: Redeeming 50% of shares (proportional)");
  console.log("-".repeat(70));

  const sharesToRedeem = new BN(Number(mintInfo2.supply) / 2);

  const redeemPropTx = await program.methods
    .redeemProportional(sharesToRedeem, new BN(0))
    .accountsPartial({
      user: payer.publicKey, vault: vaultPda, sharesMint,
      userSharesAccount: userSharesAta.address,
      tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      // Asset A: [AssetEntry, OraclePrice, vault_ata, user_ata, mint]
      { pubkey: assetEntryA, isWritable: false, isSigner: false },
      { pubkey: oraclePriceA, isWritable: false, isSigner: false },
      { pubkey: assetVaultAKeypair.publicKey, isWritable: true, isSigner: false },
      { pubkey: userAtaA.address, isWritable: true, isSigner: false },
      { pubkey: mintA, isWritable: false, isSigner: false },
      // Asset B: [AssetEntry, OraclePrice, vault_ata, user_ata, mint]
      { pubkey: assetEntryB, isWritable: false, isSigner: false },
      { pubkey: oraclePriceB, isWritable: false, isSigner: false },
      { pubkey: assetVaultBKeypair.publicKey, isWritable: true, isSigner: false },
      { pubkey: userAtaB.address, isWritable: true, isSigner: false },
      { pubkey: mintB, isWritable: false, isSigner: false },
    ])
    .rpc();
  console.log(`  ✅ Proportional redeem: ${explorerUrl(redeemPropTx)}`);

  const mintInfo3 = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
  console.log(`  Total shares after proportional redeem: ${mintInfo3.supply}`);

  const userBalA3 = await getAccount(connection, userAtaA.address, undefined, TOKEN_PROGRAM_ID);
  const userBalB3 = await getAccount(connection, userAtaB.address, undefined, TOKEN_PROGRAM_ID);
  console.log(`  User ATA A balance: ${userBalA3.amount}`);
  console.log(`  User ATA B balance: ${userBalB3.amount}`);

  // Step 11: Redeem single asset B
  console.log("\n" + "-".repeat(70));
  console.log("Step 11: Redeeming single asset B (all remaining shares)");
  console.log("-".repeat(70));

  const mintInfo4 = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
  const sharesToRedeemSingle = mintInfo4.supply;

  const redeemSingleTx = await program.methods
    .redeemSingle(sharesToRedeemSingle, new BN(0))
    .accounts({
      user: payer.publicKey, vault: vaultPda,
      assetEntry: assetEntryB,
      assetMint: mintB,
      oraclePrice: oraclePriceB,
      assetVaultAccount: assetVaultBKeypair.publicKey,
      userAssetAccount: userAtaB.address,
      sharesMint: sharesMint,
      userSharesAccount: userSharesAta.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ✅ Single asset redeem: ${explorerUrl(redeemSingleTx)}`);

  const mintInfo5 = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
  console.log(`  Total shares after single redeem: ${mintInfo5.supply}`);

  const vaultBalB5 = await getAccount(connection, assetVaultBKeypair.publicKey, undefined, TOKEN_PROGRAM_ID);
  console.log(`  Vault B balance: ${vaultBalB5.amount}`);

  // Step 12: Update weights (adjust A to 80%, B to 20%)
  console.log("\n" + "-".repeat(70));
  console.log("Step 12: Updating weights (A: 8000 bps, B: 2000 bps)");
  console.log("-".repeat(70));

  // Update A from 5000 -> 8000
  const updateWeightATx = await program.methods
    .updateWeights(8_000)
    .accountsPartial({
      vault: vaultPda, authority: payer.publicKey,
      assetEntry: assetEntryA,
    })
    .remainingAccounts([
      { pubkey: assetEntryB, isWritable: false, isSigner: false },
    ])
    .rpc();
  console.log(`  ✅ Weight A updated to 8000: ${explorerUrl(updateWeightATx)}`);

  // Update B from 5000 -> 2000
  const updateWeightBTx = await program.methods
    .updateWeights(2_000)
    .accountsPartial({
      vault: vaultPda, authority: payer.publicKey,
      assetEntry: assetEntryB,
    })
    .remainingAccounts([
      { pubkey: assetEntryA, isWritable: false, isSigner: false },
    ])
    .rpc();
  console.log(`  ✅ Weight B updated to 2000: ${explorerUrl(updateWeightBTx)}`);

  const entryA = await program.account.assetEntry.fetch(assetEntryA);
  const entryB = await program.account.assetEntry.fetch(assetEntryB);
  console.log(`  Asset A weight: ${entryA.targetWeightBps} bps`);
  console.log(`  Asset B weight: ${entryB.targetWeightBps} bps`);

  // Step 13: Pause and unpause
  console.log("\n" + "-".repeat(70));
  console.log("Step 13: Testing pause/unpause");
  console.log("-".repeat(70));

  const pauseTx = await program.methods.pause()
    .accounts({ vault: vaultPda, authority: payer.publicKey })
    .rpc();
  console.log(`  ✅ Vault paused: ${explorerUrl(pauseTx)}`);

  const vaultPaused = await program.account.multiAssetVault.fetch(vaultPda);
  console.log(`  Vault paused state: ${vaultPaused.paused}`);

  const unpauseTx = await program.methods.unpause()
    .accounts({ vault: vaultPda, authority: payer.publicKey })
    .rpc();
  console.log(`  ✅ Vault unpaused: ${explorerUrl(unpauseTx)}`);

  const vaultUnpaused = await program.account.multiAssetVault.fetch(vaultPda);
  console.log(`  Vault paused state: ${vaultUnpaused.paused}`);

  // Step 14: Final state
  console.log("\n" + "-".repeat(70));
  console.log("Step 14: Final vault state");
  console.log("-".repeat(70));

  const finalVault = await program.account.multiAssetVault.fetch(vaultPda);
  console.log(`  Vault ID: ${finalVault.vaultId}`);
  console.log(`  Num Assets: ${finalVault.numAssets}`);
  console.log(`  Base Decimals: ${finalVault.baseDecimals}`);
  console.log(`  Authority: ${finalVault.authority}`);
  console.log(`  Paused: ${finalVault.paused}`);
  console.log(`  Total Shares: ${finalVault.totalShares}`);

  const finalMint = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
  console.log(`  Shares Mint Supply: ${finalMint.supply}`);

  console.log("\n" + "=".repeat(70));
  console.log("  ✅ All steps completed successfully!");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
