/**
 * Can a sealed value be moved and still open?
 *
 * THE PROBLEM THIS EXISTS FOR. Until this change every vault ciphertext was
 * self contained: iv plus AES-GCM output, opened by whoever held the key and
 * nothing else. Anyone who could write the database could therefore copy one
 * column's ciphertext into another column, or one user's row into another
 * user's row, and the app would open it and believe it. The bytes were
 * authentic; only their LOCATION was a lie, and nothing checked the location.
 *
 * THE FIX, in the binding shape settled 2026-09-04 and amended the same day
 * under review. The AAD is the UTF-8 bytes of
 *   <domain>/v1|<schema>.<table>|<column>|<row uuid>
 * so a ciphertext only opens where it was written. household_id is
 * deliberately excluded; the column name is deliberately included.
 *
 * WHAT THIS SUITE ASSERTS. Two transplants that used to succeed now fail:
 * across columns of the SAME row, and across rows of the same column. Plus
 * the two properties that make the change shippable without a migration: a
 * value written before this change still opens, and the envelope marker
 * cannot be cleared to downgrade a bound value back to an unbound one.
 *
 * EVERY TEST CARRIES ITS OWN POSITIVE CONTROL. A "rejects" assertion passes
 * just as happily when the crypto is broken outright, so each negative case
 * is paired with the same value opening correctly in its own place. Without
 * that pairing this file would report success while covering nothing.
 *
 * ZKA. Every input here is synthetic. No plaintext, no address, no txid, no
 * wallet identifying value and no customer material is involved. The recovery
 * code is minted by the shipped generator at run time rather than written
 * down here.
 */
import { describe, expect, it } from "vitest";

import {
  BOUND_ENVELOPE_PREFIX,
  VAULT_AAD_DOMAIN,
  buildVaultAad,
  decryptText,
  decryptTextBound,
  encryptText,
  encryptTextBound,
  generateRecoveryCode,
  importMekFromRaw,
  unwrapMekWithRecovery,
  wrapMekWithRecovery,
} from "@/lib/vault";

const USER_A = "11111111-2222-3333-4444-555555555555";
const USER_B = "99999999-8888-7777-6666-555555555555";

const PAYLOAD = "synthetic-vault-payload-not-a-customer-value";

const mek = () => importMekFromRaw(crypto.getRandomValues(new Uint8Array(32)));

const aad = (column: string, rowId: string) =>
  buildVaultAad({ table: "vault_metadata", column, rowId });

describe("buildVaultAad produces the ruled string", () => {
  it("is domain, schema-qualified table, column, row id, in that order", () => {
    const bytes = buildVaultAad({
      table: "accounts",
      column: "enc_name",
      rowId: "3f2b9c14-0000-4000-8000-000000000000",
    });
    expect(new TextDecoder().decode(bytes)).toBe(
      "owm/v1|public.accounts|enc_name|3f2b9c14-0000-4000-8000-000000000000",
    );
    expect(VAULT_AAD_DOMAIN).toBe("owm");
  });

  it("refuses to build an AAD with a piece missing", () => {
    // A defaulted or empty component would bind the value to a place that is
    // not where it lives, which is worse than not binding it: it would open
    // anywhere that shared the same gap.
    expect(() => aad("", USER_A)).toThrow();
    expect(() => aad("enc_name", "")).toThrow();
    expect(() => buildVaultAad({ table: "", column: "enc_name", rowId: USER_A })).toThrow();
  });
});

describe("a sealed value does not survive being moved", () => {
  it("a ciphertext from one column does not open as another column of the same row", async () => {
    const key = await mek();
    const sealed = await encryptTextBound(PAYLOAD, key, aad("verifier_ciphertext", USER_A));

    // Positive control: it opens where it was written.
    await expect(decryptTextBound(sealed, key, aad("verifier_ciphertext", USER_A))).resolves.toBe(
      PAYLOAD,
    );

    // The transplant. Same row, same key, same bytes, different column.
    await expect(
      decryptTextBound(sealed, key, aad("recovery_ciphertext", USER_A)),
    ).rejects.toThrow();
  });

  it("a ciphertext from one user's row does not open on another user's row", async () => {
    const key = await mek();
    const sealed = await encryptTextBound(PAYLOAD, key, aad("enc_private_key", USER_A));

    await expect(decryptTextBound(sealed, key, aad("enc_private_key", USER_A))).resolves.toBe(
      PAYLOAD,
    );

    await expect(decryptTextBound(sealed, key, aad("enc_private_key", USER_B))).rejects.toThrow();
  });

  it("the same refusal reaches the wrap helpers, not only the raw primitive", async () => {
    // encryptTextBound is the primitive; the MEK wraps are what actually get
    // written to vault_metadata, so the property has to hold through them.
    const mekBytes = crypto.getRandomValues(new Uint8Array(32));
    const code = await generateRecoveryCode();

    const wrapped = await wrapMekWithRecovery(
      mekBytes.buffer as ArrayBuffer,
      code,
      aad("recovery_ciphertext", USER_A),
    );

    const recovered = await unwrapMekWithRecovery(
      wrapped,
      code,
      aad("recovery_ciphertext", USER_A),
    );
    expect(Array.from(recovered)).toEqual(Array.from(mekBytes));

    await expect(
      unwrapMekWithRecovery(wrapped, code, aad("recovery_ciphertext", USER_B)),
    ).rejects.toThrow();
  });
});

describe("existing rows keep opening, and cannot be downgraded", () => {
  it("a value written before this change still opens", async () => {
    // This is what is in the database today: no envelope prefix, no AAD. It
    // has to open through the new reader or the change is a migration, and
    // phase 1 is explicitly not one.
    const key = await mek();
    const legacy = await encryptText(PAYLOAD, key);
    expect(legacy.startsWith(BOUND_ENVELOPE_PREFIX)).toBe(false);

    await expect(decryptTextBound(legacy, key, aad("verifier_ciphertext", USER_A))).resolves.toBe(
      PAYLOAD,
    );
    // And the AAD passed is genuinely ignored for it, rather than happening
    // to match: any other AAD opens it too.
    await expect(decryptTextBound(legacy, key, aad("enc_hmac_key", USER_B))).resolves.toBe(PAYLOAD);
  });

  it("stripping the envelope marker does not turn a bound value into an unbound one", async () => {
    // The marker lives on the stored value rather than in a flag column for
    // exactly this reason. Clearing a flag would be a downgrade; clearing
    // these three characters only produces something that will not open.
    const key = await mek();
    const sealed = await encryptTextBound(PAYLOAD, key, aad("verifier_ciphertext", USER_A));
    expect(sealed.startsWith(BOUND_ENVELOPE_PREFIX)).toBe(true);

    const stripped = sealed.slice(BOUND_ENVELOPE_PREFIX.length);
    await expect(
      decryptTextBound(stripped, key, aad("verifier_ciphertext", USER_A)),
    ).rejects.toThrow();
    await expect(decryptText(stripped, key)).rejects.toThrow();
  });
});
