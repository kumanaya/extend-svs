/**
 * SVS-8 Edge Cases Script - Security and Error Conditions
 *
 * Tests security and error conditions on devnet:
 * - Deposit below minimum
 * - Slippage protection on deposit
 * - Deposit on paused vault
 * - Redeem with slippage
 * - Redeem more shares than balance
 * - Non-authority operations
 * - Invalid weight totals
 * - Oracle staleness (conceptual)
 *
 * Run: npx ts-node scripts/svs-8/edge-cases.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getMint, getAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  setupScript, getVaultPDA, getSharesMintPDA, getAssetEntryPDA,
  getOraclePricePDA, PRICE_SCALE,
} from "./helpers";

async function expectError(fn: () => Promise<any>, label: string): Promise<boolean> {
  try {
    await fn();
    console.log(`  ❌ FAIL: ${label} should have thrown`);
    return false;
  } catch (_e) {
    console.log(`  ✅ PASS: ${label} correctly rejected`);
    return true;
  }
}

async function main() {
  const { connection, payer, program, programId } = await setupScript("Edge Cases - Security Tests");

  console.log("\n" + "=".repeat(70));
  console.log("  SVS-8 Edge Case Tests");
  console.log("=".repeat(70) + "\n");

  // Setup vault for edge case testing
  console.log("--- Setting up test vault ---\n");

  const mintA = await createMint(connection, payer, payer.publicKey, null, 6, Keypair.generate(), undefined, TOKEN_PROGRAM_ID);
  const mintB = await createMint(connection, payer, payer.publicKey, null, 6, Keypair.generate(), undefined, TOKEN_PROGRAM_ID);

  const userAtaA = await getOrCreateAssociatedTokenAccount(connection, payer, mintA, payer.publicKey, false, undefined, undefined, TOKEN_PROGRAM_ID);
  const userAtaB = await getOrCreateAssociatedTokenAccount(connection, payer, mintB, payer.publicKey, false, undefined, undefined, TOKEN_PROGRAM_ID);

  await mintTo(connection, payer, mintA, userAtaA.address, payer.publicKey, 10_000_000, [], undefined, TOKEN_PROGRAM_ID);
  await mintTo(connection, payer, mintB, userAtaB.address, payer.publicKey, 10_000_000, [], undefined, TOKEN_PROGRAM_ID);
  console.log(`  Created mints and funded user accounts\n`);

  const vaultId = new BN(Date.now() % 1_000_000);
  const [vaultPda] = getVaultPDA(programId, vaultId);
  const [sharesMint] = getSharesMintPDA(programId, vaultPda);
  const [assetEntryA] = getAssetEntryPDA(programId, vaultPda, mintA);
  const [assetEntryB] = getAssetEntryPDA(programId, vaultPda, mintB);
  const [oraclePriceA] = getOraclePricePDA(programId, vaultPda, mintA);
  const [oraclePriceB] = getOraclePricePDA(programId, vaultPda, mintB);
  const assetVaultAKeypair = Keypair.generate();
  const assetVaultBKeypair = Keypair.generate();

  await program.methods.initialize(vaultId, 6)
    .accountsPartial({ authority: payer.publicKey, sharesMint, tokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
    .rpc();
  console.log(`  Vault initialized (ID: ${vaultId})`);

  await program.methods.addAsset(5_000)
    .accountsPartial({ vault: vaultPda, authority: payer.publicKey, assetMint: mintA, oracle: Keypair.generate().publicKey, assetEntry: assetEntryA, assetVault: assetVaultAKeypair.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
    .signers([assetVaultAKeypair]).rpc();
  console.log(`  Asset A added (5000 bps)`);

  await program.methods.addAsset(5_000)
    .accountsPartial({ vault: vaultPda, authority: payer.publicKey, assetMint: mintB, oracle: Keypair.generate().publicKey, assetEntry: assetEntryB, assetVault: assetVaultBKeypair.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
    .signers([assetVaultBKeypair]).rpc();
  console.log(`  Asset B added (5000 bps)`);

  await program.methods.updateOracle(new BN(PRICE_SCALE))
    .accountsPartial({ vault: vaultPda, assetMint: mintA, systemProgram: SystemProgram.programId })
    .rpc();
  await program.methods.updateOracle(new BN(PRICE_SCALE))
    .accountsPartial({ vault: vaultPda, assetMint: mintB, systemProgram: SystemProgram.programId })
    .rpc();
  console.log(`  Oracle prices set\n`);

  const userSharesAta = await getOrCreateAssociatedTokenAccount(connection, payer, sharesMint, payer.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID);

  const depositAccounts = {
    user: payer.publicKey, vault: vaultPda, assetEntry: assetEntryA,
    assetMint: mintA, oraclePrice: oraclePriceA,
    assetVaultAccount: assetVaultAKeypair.publicKey,
    sharesMint, userAssetAccount: userAtaA.address,
    userSharesAccount: userSharesAta.address,
    tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  // Edge Case 1: Deposit below minimum
  console.log("--- Edge Case Tests ---\n");

  await expectError(
    () => program.methods.depositSingle(new BN(10), new BN(0)).accountsPartial(depositAccounts).rpc(),
    "Deposit below minimum (10 < 1000)"
  );

  // Edge Case 2: Slippage protection on deposit
  await expectError(
    () => program.methods.depositSingle(new BN(1_000_000), new BN(999_999_999_999)).accountsPartial(depositAccounts).rpc(),
    "Deposit slippage protection (min_shares_out too high)"
  );

  // Edge Case 3: Pause vault
  await program.methods.pause().accounts({ vault: vaultPda, authority: payer.publicKey }).rpc();
  console.log(`  ✅ Vault paused for testing`);

  await expectError(
    () => program.methods.depositSingle(new BN(1_000_000), new BN(0)).accountsPartial(depositAccounts).rpc(),
    "Deposit on paused vault"
  );

  // Edge Case 4: Non-authority pause
  const wrongUser = Keypair.generate();
  await expectError(
    () => program.methods.pause().accounts({ vault: vaultPda, authority: wrongUser.publicKey }).rpc(),
    "Pause from non-authority"
  );

  // Unpause for remaining tests
  await program.methods.unpause().accounts({ vault: vaultPda, authority: payer.publicKey }).rpc();
  console.log(`  ✅ Vault unpaused\n`);

  // Valid deposit for redeem tests
  await program.methods.depositSingle(new BN(1_000_000), new BN(0)).accountsPartial(depositAccounts).rpc();
  console.log(`  Valid deposit done for redeem tests\n`);

  // Edge Case 5: Redeem more shares than balance
  const mintInfo = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
  await expectError(
    () => program.methods.redeemProportional(new BN(Number(mintInfo.supply) * 2), new BN(0))
      .accountsPartial({ user: payer.publicKey, vault: vaultPda, sharesMint, userSharesAccount: userSharesAta.address, tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .remainingAccounts([
        { pubkey: assetEntryA, isWritable: false, isSigner: false },
        { pubkey: oraclePriceA, isWritable: false, isSigner: false },
        { pubkey: assetVaultAKeypair.publicKey, isWritable: true, isSigner: false },
        { pubkey: userAtaA.address, isWritable: true, isSigner: false },
        { pubkey: mintA, isWritable: false, isSigner: false },
        { pubkey: assetEntryB, isWritable: false, isSigner: false },
        { pubkey: oraclePriceB, isWritable: false, isSigner: false },
        { pubkey: assetVaultBKeypair.publicKey, isWritable: true, isSigner: false },
        { pubkey: userAtaB.address, isWritable: true, isSigner: false },
        { pubkey: mintB, isWritable: false, isSigner: false },
      ])
      .rpc(),
    "Redeem more shares than balance"
  );

  // Edge Case 6: Redeem single with slippage
  const mintInfo2 = await getMint(connection, sharesMint, undefined, TOKEN_2022_PROGRAM_ID);
  const sharesToRedeemSingle = new BN(Number(mintInfo2.supply) / 4);

  await expectError(
    () => program.methods.redeemSingle(sharesToRedeemSingle, new BN(999_999_999_999))
      .accounts({ user: payer.publicKey, vault: vaultPda, assetEntry: assetEntryA, assetMint: mintA, oraclePrice: oraclePriceA, assetVaultAccount: assetVaultAKeypair.publicKey, userAssetAccount: userAtaA.address, sharesMint, userSharesAccount: userSharesAta.address, tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .rpc(),
    "Redeem single with slippage (min too high)"
  );

  // Edge Case 7: Non-authority update_weights
  await expectError(
    () => program.methods.updateWeights(3_000)
      .accountsPartial({ vault: vaultPda, authority: wrongUser.publicKey, assetEntry: assetEntryA })
      .remainingAccounts([{ pubkey: assetEntryB, isWritable: false, isSigner: false }])
      .rpc(),
    "Update weights from non-authority"
  );

  // Edge Case 8: Invalid weight total (must sum to 10000)
  await expectError(
    () => program.methods.updateWeights(8_000)
      .accountsPartial({ vault: vaultPda, authority: payer.publicKey, assetEntry: assetEntryA })
      .remainingAccounts([{ pubkey: assetEntryB, isWritable: false, isSigner: false }])
      .rpc(),
    "Invalid weight total (8000 + 5000 = 13000 > 10000)"
  );

  // Edge Case 9: Non-authority remove_asset
  await expectError(
    () => program.methods.removeAsset()
      .accountsPartial({ vault: vaultPda, authority: wrongUser.publicKey, assetEntry: assetEntryA, assetVault: assetVaultAKeypair.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .remainingAccounts([{ pubkey: assetEntryB, isWritable: true, isSigner: false }])
      .rpc(),
    "Remove asset from non-authority"
  );

  // Edge Case 10: Redeem with zero shares
  await expectError(
    () => program.methods.redeemSingle(new BN(0), new BN(0))
      .accounts({ user: payer.publicKey, vault: vaultPda, assetEntry: assetEntryA, assetMint: mintA, oraclePrice: oraclePriceA, assetVaultAccount: assetVaultAKeypair.publicKey, userAssetAccount: userAtaA.address, sharesMint, userSharesAccount: userSharesAta.address, tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .rpc(),
    "Redeem with zero shares"
  );

  // Edge Case 11: Cross-asset drain attempt (subset attack)
  await expectError(
    () => program.methods.depositProportional(new BN(500_000), new BN(0))
      .accountsPartial({ user: payer.publicKey, vault: vaultPda, sharesMint, userSharesAccount: userSharesAta.address, tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .remainingAccounts([
        // Only asset A — missing asset B (subset attack)
        { pubkey: assetEntryA, isWritable: false, isSigner: false },
        { pubkey: oraclePriceA, isWritable: false, isSigner: false },
        { pubkey: assetVaultAKeypair.publicKey, isWritable: true, isSigner: false },
        { pubkey: userAtaA.address, isWritable: true, isSigner: false },
        { pubkey: mintA, isWritable: false, isSigner: false },
      ])
      .rpc(),
    "Deposit proportional with subset of assets (subset attack)"
  );

  // Edge Case 12: Wrong vault token account in redeem
  await expectError(
    () => program.methods.redeemProportional(new BN(1), new BN(0))
      .accountsPartial({ user: payer.publicKey, vault: vaultPda, sharesMint, userSharesAccount: userSharesAta.address, tokenProgram: TOKEN_PROGRAM_ID, sharesTokenProgram: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .remainingAccounts([
        // Asset A with vault_ta swapped for vault_ta of asset B (cross-asset drain)
        { pubkey: assetEntryA, isWritable: false, isSigner: false },
        { pubkey: oraclePriceA, isWritable: false, isSigner: false },
        { pubkey: assetVaultBKeypair.publicKey, isWritable: true, isSigner: false }, // wrong vault_ta
        { pubkey: userAtaA.address, isWritable: true, isSigner: false },
        { pubkey: mintA, isWritable: false, isSigner: false },
        { pubkey: assetEntryB, isWritable: false, isSigner: false },
        { pubkey: oraclePriceB, isWritable: false, isSigner: false },
        { pubkey: assetVaultBKeypair.publicKey, isWritable: true, isSigner: false },
        { pubkey: userAtaB.address, isWritable: true, isSigner: false },
        { pubkey: mintB, isWritable: false, isSigner: false },
      ])
      .rpc(),
    "Redeem with wrong vault token account (cross-asset drain)"
  );

  console.log("\n" + "=".repeat(70));
  console.log("  ✅ All edge case tests completed!");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);
