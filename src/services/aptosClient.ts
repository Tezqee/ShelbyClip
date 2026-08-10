import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

// ShelbyNet custom Aptos node endpoints
const SHELBYNET_FULLNODE = 'https://api.shelbynet.shelby.xyz/v1';
const SHELBYNET_INDEXER = 'https://api.shelbynet.aptoslabs.com/v1/graphql';

// Initialize Aptos Config for ShelbyNet
const config = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: SHELBYNET_FULLNODE,
  indexer: SHELBYNET_INDEXER,
});

// Export a singleton instance of the Aptos client
export const aptos = new Aptos(config);

/**
 * Helper to normalize and validate Aptos addresses
 */
export function normalizeAddress(address: string): string {
  if (!address) return "";
  const clean = address.toLowerCase().trim().replace(/^0x/, "");
  if (!clean) return "";
  return "0x" + clean.padStart(64, "0");
}

/**
 * Helper to get short address for display (e.g., 0x123...abcd)
 */
export function shortenAddress(address: string): string {
  if (!address) return "";
  const normalized = normalizeAddress(address);
  return `${normalized.substring(0, 6)}...${normalized.substring(normalized.length - 4)}`;
}

/**
 * Check if an account exists on-chain
 */
export async function accountExists(address: string): Promise<boolean> {
  try {
    await aptos.getAccountInfo({ accountAddress: address });
    return true;
  } catch (error: any) {
    if (error.status === 404) return false;
    throw error;
  }
}
