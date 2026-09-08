import "dotenv/config";
import {
  T3nClient,
  setEnvironment,
  loadWasmComponent,
  fetchTrustedManifest,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet");

const T3N_API_KEY = process.env.T3N_API_KEY;
if (!T3N_API_KEY) {
  throw new Error("Missing T3N_API_KEY in environment");
}

console.log("Loading WASM cryptographic component...");
const wasmComponent = await loadWasmComponent();
const address = eth_get_address(T3N_API_KEY);
console.log("Derived Ethereum address:", address);

console.log("Using trust anchor...");
// Note: fetchTrustedManifest("testnet") currently throws malformed manifest error against sg.testnet
const trustAnchor = { unsafe_trust_server: true as const };

const t3n = new T3nClient({
  trustAnchor,
  wasmComponent,
  handlers: {
    EthSign: metamask_sign(address, undefined, T3N_API_KEY),
  },
});

console.log("Executing cryptographic handshake with T3N enclave...");
await t3n.handshake();
console.log("Handshake successful!");

console.log("Authenticating DID with T3N network...");
const did = await t3n.authenticate(createEthAuthInput(address));
const tenantDid = did.value;

console.log("==========================================");
console.log("SUCCESS! Connected as:", tenantDid);
console.log("==========================================");
