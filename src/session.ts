/**
 * T3N session bootstrap shared by every entry point.
 *
 * Resolves the trust anchor with a documented fallback: `fetchTrustedManifest`
 * currently rejects the Singapore testnet manifest (see README "Bug Reports"),
 * so we fall back to the explicit opt-out for testnet only. Production keeps
 * verification mandatory — it must never silently downgrade.
 */

import {
  T3nClient,
  setEnvironment,
  loadWasmComponent,
  fetchTrustedManifest,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
  type TrustAnchorOrUnsafe,
} from "@terminal3/t3n-sdk";

import { requireApiKey, readEnvironment } from "./env.js";

export interface T3nSession {
  client: T3nClient;
  /** The DID the platform assigned — read from the session, never configured. */
  did: string;
  /** Ethereum address derived from the key, used for SIWE-style auth. */
  address: string;
  environment: "testnet" | "production";
  /** True when the manifest endpoint failed and the unsafe opt-out was used. */
  manifestFallbackUsed: boolean;
}

async function resolveTrustAnchor(
  environment: "testnet" | "production"
): Promise<{ anchor: TrustAnchorOrUnsafe; fallback: boolean }> {
  try {
    return { anchor: await fetchTrustedManifest(environment), fallback: false };
  } catch (error) {
    if (environment === "production") {
      throw new Error(
        `fetchTrustedManifest failed on production — refusing to continue ` +
          `without enclave verification. Cause: ${(error as Error).message}`
      );
    }
    // Known testnet issue: the manifest is served but the SDK's parser rejects
    // it. Unsafe opt-out is acceptable here (local/test cluster only).
    return { anchor: { unsafe_trust_server: true }, fallback: true };
  }
}

/** Open an authenticated T3N session for the given key. */
export async function createSession(
  key: string,
  environment?: "testnet" | "production"
): Promise<T3nSession> {
  const env = environment ?? readEnvironment();
  setEnvironment(env);

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(key);
  const { anchor, fallback } = await resolveTrustAnchor(env);

  const client = new T3nClient({
    trustAnchor: anchor,
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, key) },
  });

  await client.handshake();
  const auth = await client.authenticate(createEthAuthInput(address));

  return {
    client,
    did: auth.value,
    address,
    environment: env,
    manifestFallbackUsed: fallback,
  };
}

/** Convenience: session for the tenant developer key. */
export async function createTenantSession(): Promise<T3nSession> {
  return createSession(requireApiKey("T3N_API_KEY"));
}
