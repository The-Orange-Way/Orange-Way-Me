import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Push-only gate: this spec requires the Supabase service key to run
// DB-level assertions after the vault password change. On pull_request
// runs where OWM_E2E_SUPABASE_SECRET_KEY is not set, every test in this
// file is skipped and the job still passes (green skip, not red fail).
const HAS_SERVICE_KEY = !!process.env.OWM_E2E_SUPABASE_SECRET_KEY

const EMAIL = process.env.OWM_DEV_E2E_EMAIL ?? ''
const PASSWORD = process.env.OWM_DEV_E2E_PASSWORD ?? ''
const VAULT_PW = process.env.OWM_DEV_E2E_VAULT_PASSWORD ?? ''
// Rotated password used as a temporary substitute during this spec.
const ROTATED_VAULT_PW = VAULT_PW + '-rotated'

// OWM dev project Supabase URL (not a secret: it is the public project URL).
const SUPABASE_URL =
  process.env.OWM_E2E_SUPABASE_URL ?? 'https://bogmoovbjpvcvdqrmjgt.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.OWM_E2E_SUPABASE_SECRET_KEY ?? ''

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

  // The app may route through a vault-unlock screen before /dashboard.
  const unlockHeading = page.getByRole('heading', { name: /unlock vault/i })
  if (await unlockHeading.isVisible({ timeout: 8000 }).catch(() => false)) {
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

// -- tests --

test.describe('AEAD vault password change round-trip (OW-T0398)', () => {
  test.skip(!HAS_SERVICE_KEY, 'push-only: OWM_E2E_SUPABASE_SECRET_KEY not set')

  test('wrong current password is rejected and dialog stays open', async ({ page }) => {
    await signInAndUnlock(page)
    await openChangeVaultPasswordDialog(page)
    await fillAndSubmitChangeForm(page, 'definitely-wrong-password', ROTATED_VAULT_PW)

    // Dialog must remain open and an error notification must be visible.
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 })
  })

  test('change vault password: v1. prefix written to DB, sign-out and sign-in with new password succeeds', async ({
    page,
  }) => {
    let passwordRotated = false

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    })

    try {
      // 1. Sign in and unlock vault with original password.
      await signInAndUnlock(page)

      // 2. Open the dialog and change the vault password.
      await openChangeVaultPasswordDialog(page)
      await fillAndSubmitChangeForm(page, VAULT_PW, ROTATED_VAULT_PW)

      // 3. Confirm success toast and dialog closure.
      await expect(page.getByText(/vault password changed/i)).toBeVisible({ timeout: 15000 })
      passwordRotated = true
      await expect(page.getByRole('dialog')).not.toBeVisible()

      // 4. DB assertion: enc_mek_ciphertext and verifier_ciphertext must carry
      //    the AEAD bound-envelope prefix introduced by PR #921.
      //    buildVaultAad() and encryptTextBound() in src/lib/vault.ts prepend
      //    BOUND_ENVELOPE_PREFIX = "v1." to every newly-written ciphertext.
      //    A ciphertext that still starts without "v1." came through the legacy
      //    path and is not bound to its row or column -- the AEAD control is
      //    therefore not exercised.
      const {
        data: { users },
        error: listErr,
      } = await sb.auth.admin.listUsers()
      expect(listErr).toBeNull()
      const fixtureUser = users.find((u) => u.email === EMAIL)
      expect(fixtureUser, `fixture account ${EMAIL} not found in auth.users`).toBeDefined()

      const { data: row, error: rowErr } = await sb
        .from('vault_metadata')
        .select('enc_mek_ciphertext, verifier_ciphertext')
        .eq('user_id', fixtureUser!.id)
        .single()
      expect(rowErr).toBeNull()
      expect(row!.enc_mek_ciphertext, 'enc_mek_ciphertext must carry AEAD v1. prefix').toMatch(
        /^v1\./,
      )
      expect(row!.verifier_ciphertext, 'verifier_ciphertext must carry AEAD v1. prefix').toMatch(
        /^v1\./,
      )

      // 5. Sign out and sign back in with the rotated vault password to verify
      //    the new ciphertext is decryptable end-to-end through the real UI.
      await clearAuthSession(page)
      await signInAndUnlock(page, ROTATED_VAULT_PW)
      expect(page.url()).toContain('/dashboard')
    } finally {
      // Restore fixture: if the password was rotated (even if an assertion
      // above failed), change it back so the next run starts from the same
      // state. This mirrors the try/finally restore pattern in the OWB spec.
      if (passwordRotated) {
        await clearAuthSession(page)
        await signInAndUnlock(page, ROTATED_VAULT_PW)
        await openChangeVaultPasswordDialog(page)
        await fillAndSubmitChangeForm(page, ROTATED_VAULT_PW, VAULT_PW)
        await expect(page.getByText(/vault password changed/i)).toBeVisible({ timeout: 15000 })
      }
    }
  })
})
