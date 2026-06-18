/**
 * Minimal ambient types for libsodium-wrappers-sumo — only the surface this
 * app uses for OPK sealed boxes. The package ships no .d.ts and the @types
 * stub is deprecated/empty, so we declare exactly what src/lib/or/opk.ts
 * touches.
 */
declare module "libsodium-wrappers-sumo" {
  interface KeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    keyType: string;
  }
  interface Base64Variants {
    ORIGINAL: number;
    ORIGINAL_NO_PADDING: number;
    URLSAFE: number;
    URLSAFE_NO_PADDING: number;
  }
  interface Sodium {
    ready: Promise<void>;
    base64_variants: Base64Variants;
    crypto_box_seed_keypair(seed: Uint8Array): KeyPair;
    crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
    crypto_box_seal_open(
      ciphertext: Uint8Array,
      publicKey: Uint8Array,
      privateKey: Uint8Array,
    ): Uint8Array;
    to_base64(input: Uint8Array, variant?: number): string;
    from_base64(input: string, variant?: number): Uint8Array;
    to_string(bytes: Uint8Array): string;
    from_string(str: string): Uint8Array;
  }
  const sodium: Sodium;
  export default sodium;
}
