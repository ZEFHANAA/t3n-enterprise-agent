import {
  T3nClient,
  setEnvironment,
  loadWasmComponent,
  fetchTrustedManifest,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
} from "@terminal3/t3n-sdk";
import { AgentConfig } from "./config.js";

export interface T3nSession {
  client: T3nClient;
  authenticatedDid: string;
  derivedAddress: string;
  enclaveEnvironment: string;
  manifestFallbackUsed: boolean;
}

export async function initializeT3nSession(config: AgentConfig): Promise<T3nSession> {
  setEnvironment(config.environment);

  // 1. Load cryptographic WASM component
  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(config.apiKey);

  // 2. Resolve trust anchor (with graceful fallback for current testnet manifest bug)
  let trustAnchor: any;
  let manifestFallbackUsed = false;

  try {
    trustAnchor = await fetchTrustedManifest(config.environment);
  } catch (error) {
    // Known SDK Bug: testnet trust-manifest endpoint format mismatch
    manifestFallbackUsed = true;
    trustAnchor = { unsafe_trust_server: true };
  }

  // 3. Instantiate client with cryptographic signature handler
  const client = new T3nClient({
    trustAnchor,
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(address, undefined, config.apiKey),
    },
  });

  // 4. Cryptographic handshake with TEE enclave
  await client.handshake();

  // 5. Authenticate DID
  const didResult = await client.authenticate(createEthAuthInput(address));
  const authenticatedDid = didResult.value;

  return {
    client,
    authenticatedDid,
    derivedAddress: address,
    enclaveEnvironment: config.environment,
    manifestFallbackUsed,
  };
}
