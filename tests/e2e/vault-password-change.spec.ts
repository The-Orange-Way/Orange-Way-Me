import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Credentials: the same names auth.setup.ts reads (lines 61-63), so the
// authenticated project gate is shared and the two never drift.
const EMAIL = process.env.E2E_USER_EMAIL ?? ''
const PASSWORD = process.env.E2E_USER_PASSWORD ?? ''
const VAULT_PW = process.env.E2E_VAULT_PASSWORD ?? ''

// Public Supabase project config (not secrets). Set in the dev environment
// scope in ci.yml; absent on pull_request runs where auth.setup.ts already
// skips the authenticated suite, so no additional file-scope skip is needed.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

// Serial so tests share the single fixture account without races.
test.describe.configure({ mode: 'serial' })

// -- helpers --

/**
 * Navigate to /auth, sign in, then unlock the vault if the lock screen
 * appears. vaultPassword defaults to the fixture vault password.
 */
async function signInAndUnlock(page: Page, vaultPassword: string = VAULT_PW): Promise<void> {
  await page.goto('/auth')
  await page.locator('#si-email').fill(EMAIL)
  await page.locator('#si-pw').fill(PASSWORD)
  await page.getByRole('button', { name: /^sign in/i }).click()

  // A fresh Playwright context always prompts for vault unlock before /dashboard.
  // waitFor (not isVisible) is required: isVisible answers instantly ignoring its
  // timeout argument and misses a heading that has not yet rendered (H2).
  const unlockHeading = page.getByRole('heading', { name: /unlock vault/i })
  const unlockVisible = await unlockHeading
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false)
  if (unlockVisible) {
    await page.locator('#v-pw').fill(vaultPassword)
    await page.getByRole('button', { name: /^unlock/i }).click()
  }

  await page.waitForURL('**/dashboard', { timeout: 30000 })
}

/**
 * Remove all Supabase auth tokens from localStorage to simulate a sign-out
 * without a network round-trip. Mirrors the clearAuthSession helper in the
 * OWB vault-password-change spec.
 */
async function clearAuthSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of [...Object.keys(localStorage)]) {
      if (key.includes('auth-token') || key.includes('sb-') || key.includes('supabase')) {
        localStorage.removeItem(key)
      }
    }
  })
}

/**
 * Navigate to /settings/security and open the Change vault password dialog.
 */
async function openChangeVaultPasswordDialog(page: Page): Promise<void> {
  await page.goto('/settings/security')
  await page.getByRole('button', { name: /change vault password/i }).click()
  await page.getByRole('dialog').waitFor({ state: 'visible' })
}

/**
 * Fill and submit the Change vault password dialog.
 * The form inputs have no id attributes; located by autocomplete value.
 * OWM has no recovery-kit acknowledgment step (unlike OWB).
 */
async function fillAndSubmitChangeForm(
  page: Page,
  currentPw: string,
  newPw: string,
): Promise<void> {
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[autocomplete="current-password"]').fill(currentPw)
  await dialog.locator('input[autocomplete="new-password"]').first().fill(newPw)
  await dialog.locator('input[autocomplete="new-password"]').nth(1).fill(newPw)
  await dialog.getByRole('button', { name: /change password/i }).click()
}

type VaultRow = { enc_mek_ciphertext: string; kdf_salt: string }

/**
 * Read the current user's vault_metadata row using their own session JWT.
 * This is the same read the product makes at VaultContext.tsx 1374-1379:
 * no service key or admin privilege required. RLS returns only this user's row.
 */
async function readVaultRow(page: Page): Promise<VaultRow> {
  // Extract the user's access token from localStorage (same session auth.setup.ts saved).
  const accessToken = await page.evaluate((): string | null => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      try {
        const s = JSON.parse(localStorage.getItem(key) ?? '') as Record<string, unknown>
        if (typeof s?.access_token === 'string') return s.access_token as string
      } catch {
        /* skip malformed entries */
      }
    }
    return null
  })
  expect(accessToken, 'no user session in localStorage -- was auth.setup.ts skipped?').toBeTruthy()

  // anon key + user JWT: Supabase RLS returns only this user's vault_metadata row.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken!}` } },
    auth: { persistSession: false },
  })
  const { data, error } = await sb
    .from('vault_metadata')
    .select('enc_mek_ciphertext, kdf_salt')
    .single()
  expect(error, `vault_metadata read failed: ${error?.message ?? 'unknown'}`).toBeNull()
  expect(data, 'vault_metadata row not found for this user').not.toBeNull()
  return data as VaultRow
}

// -- tests --

test.describe('AEAD vault password change round-trip (OW-T0398)', () => {
  // No trace or screenshot: this spec fills vault passwords. Traces and screenshots
  // carry typed values; without an artifact-upload step exposure is runner-only,
  // but there is no benefit to capturing them for a spec that runs correctly (M1).
  test.use({ trace: 'off', screenshot: 'off' })

  test('wrong current password is rejected and dialog stays open', async ({ page }) => {
    await signInAndUnlock(page)
    await openChangeVaultPasswordDialog(page)
    await fillAndSubmitChangeForm(page, 'definitely-wrong-password', VAULT_PW)

    // Dialog must remain open and an error notification must be visible.
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 })
  })

  test('change vault password: v1. prefix written to DB, sign-out and sign-in with same password succeeds', async ({
    page,
  }) => {
    // B4 requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.  Both are
    // public CI vars present on push runs whenever E2E credentials are also available.
    expect(
      SUPABASE_URL,
      'VITE_SUPABASE_URL must be set when E2E credentials are present',
    ).toBeTruthy()
    expect(
      SUPABASE_ANON_KEY,
      'VITE_SUPABASE_PUBLISHABLE_KEY must be set when E2E credentials are present',
    ).toBeTruthy()

    // CTO ruling OW-T0398 2026-10-01: use a same-value change (current === new ===
    // E2E_VAULT_PASSWORD). The dialog has no same-value guard (verified at
    // ChangeVaultPasswordDialog.submit and VaultContext.changeVaultPassword). A
    // same-value change still mints a fresh 16-byte kdf_salt and re-wraps the MEK
    // (VaultContext.tsx 1441), giving a new enc_mek_ciphertext to assert on without
    // the need for a rotate-and-restore cycle that is unsafe under CI cancellation.
    test.setTimeout(180_000)

    // 1. Sign in and unlock vault.
    await signInAndUnlock(page)

    // 2. Read vault row BEFORE the change (B4).
    const rowBefore = await readVaultRow(page)

    // 3. Open the dialog and submit the same-value change.
    await openChangeVaultPasswordDialog(page)
    await fillAndSubmitChangeForm(page, VAULT_PW, VAULT_PW)

    // 4. Wait for success toast.
    //    Tripwire: if the dialog rejects a same-value change, fail explicitly rather
    //    than timing out or passing vacuously. CTO ruling OW-T0398 (2026-10-01) says
    //    the form has no same-value guard. If this fires, revisit the ruling -- never
    //    work around it by adding rotation back.
    try {
      await page.getByText(/vault password changed/i).waitFor({ state: 'visible', timeout: 15000 })
    } catch {
      const alertVisible = await page.getByRole('alert').isVisible()
      const dialogOpen = await page.getByRole('dialog').isVisible()
      if (alertVisible && dialogOpen) {
        throw new Error(
          'TRIPWIRE: vault password change dialog rejected a same-value change ' +
            '(current === new === E2E_VAULT_PASSWORD). ' +
            'CTO ruling OW-T0398 2026-10-01 confirmed no same-value guard exists. ' +
            'Do not add rotation to work around this -- revisit the ruling instead.',
        )
      }
      throw new Error('vault password change: success toast did not appear within 15s')
    }
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // 5. Read vault row AFTER the change (B4).
    const rowAfter = await readVaultRow(page)

    // B4 assertions per CTO ruling OW-T0398 2026-10-01:
    //   enc_mek_ciphertext must differ AND carry the AEAD v1. envelope prefix.
    //   kdf_salt must differ (new 16-byte salt minted at VaultContext.tsx 1441).
    //   verifier_ciphertext is NOT asserted: changeVaultPassword does not write it.
    expect(
      rowAfter.enc_mek_ciphertext,
      'enc_mek_ciphertext must differ after the password change',
    ).not.toBe(rowBefore.enc_mek_ciphertext)
    expect(
      rowAfter.enc_mek_ciphertext,
      'enc_mek_ciphertext must carry AEAD v1. prefix (encryptTextBound / buildVaultAad)',
    ).toMatch(/^v1\./)
    expect(
      rowAfter.kdf_salt,
      'kdf_salt must differ after the password change (new salt per VaultContext.tsx 1441)',
    ).not.toBe(rowBefore.kdf_salt)

    // 6. Sign out and sign back in with the SAME password to prove the re-wrapped key
    //    is decryptable end-to-end through the real UI.
    //    NOT A BLOCKER per CTO OW-T0398: a cancel between the UPDATE and rewrapUserKeypair
    //    (VaultContext.tsx 1485-1498) could leave the keypair stale; if unlock fails here
    //    that is a product finding -- report it, do not skip the step.
    await clearAuthSession(page)
    await signInAndUnlock(page, VAULT_PW)
    expect(page.url()).toContain('/dashboard')
  })
})
