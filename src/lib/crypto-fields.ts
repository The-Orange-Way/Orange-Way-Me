/**
 * Per-table encrypt/decrypt helpers.
 *
 * Each helper:
 *   - Encrypts every plaintext field with AES-256-GCM using the MEK.
 *   - Returns the row shape that matches the database schema (enc_* cols).
 *   - For transactions, also computes blind-index HMACs for searchable
 *     columns (merchant, category_id).
 *
 * NEVER log decrypted output. NEVER persist plaintext to anything other
 * than React state held during a logged-in session.
 */
import { encryptText, decryptText, blindIndex } from "./vault";

// ---------- shared helpers ----------

async function encOpt(value: string | null | undefined, mek: CryptoKey): Promise<string | null> {
  if (value == null || value === "") return null;
  return encryptText(value, mek);
}

async function decOpt(value: string | null | undefined, mek: CryptoKey): Promise<string | null> {
  if (value == null || value === "") return null;
  return decryptText(value, mek);
}

// ---------- accounts ----------

export interface AccountPlain {
  name: string;
  type: string; // checking | savings | credit | bitcoin | etc
  currency: string; // USD | BTC | ...
  institution?: string | null;
  balance: string; // stored as string to preserve precision
  metadata?: Record<string, unknown> | null;
}

export interface AccountEncrypted {
  enc_name: string;
  enc_type: string;
  enc_currency: string;
  enc_institution: string | null;
  enc_balance: string;
  enc_metadata: string | null;
}

export async function encryptAccount(
  account: AccountPlain,
  mek: CryptoKey,
): Promise<AccountEncrypted> {
  return {
    enc_name: await encryptText(account.name, mek),
    enc_type: await encryptText(account.type, mek),
    enc_currency: await encryptText(account.currency, mek),
    enc_institution: await encOpt(account.institution, mek),
    enc_balance: await encryptText(account.balance, mek),
    enc_metadata: account.metadata
      ? await encryptText(JSON.stringify(account.metadata), mek)
      : null,
  };
}

export async function decryptAccount(row: AccountEncrypted, mek: CryptoKey): Promise<AccountPlain> {
  const metadataJson = await decOpt(row.enc_metadata, mek);
  return {
    name: await decryptText(row.enc_name, mek),
    type: await decryptText(row.enc_type, mek),
    currency: await decryptText(row.enc_currency, mek),
    institution: await decOpt(row.enc_institution, mek),
    balance: await decryptText(row.enc_balance, mek),
    metadata: metadataJson ? (JSON.parse(metadataJson) as Record<string, unknown>) : null,
  };
}

// ---------- transactions ----------

export interface TransactionPlain {
  amount: string;
  description: string;
  merchant?: string | null;
  category_id?: string | null;
  memo?: string | null;
  tags?: string[] | null;
  owner?: string | null;
}

export interface TransactionEncrypted {
  enc_amount: string;
  enc_description: string;
  enc_merchant: string | null;
  enc_category_id: string | null;
  enc_memo: string | null;
  enc_tags: string | null;
  enc_owner: string | null;
  hmac_merchant: string | null;
  hmac_category: string | null;
}

export async function encryptTransaction(
  txn: TransactionPlain,
  mek: CryptoKey,
  hmacKey: CryptoKey,
): Promise<TransactionEncrypted> {
  return {
    enc_amount: await encryptText(txn.amount, mek),
    enc_description: await encryptText(txn.description, mek),
    enc_merchant: await encOpt(txn.merchant, mek),
    enc_category_id: await encOpt(txn.category_id, mek),
    enc_memo: await encOpt(txn.memo, mek),
    enc_tags:
      txn.tags && txn.tags.length > 0 ? await encryptText(JSON.stringify(txn.tags), mek) : null,
    enc_owner: await encOpt(txn.owner, mek),
    hmac_merchant: txn.merchant ? await blindIndex(txn.merchant, hmacKey) : null,
    hmac_category: txn.category_id ? await blindIndex(txn.category_id, hmacKey) : null,
  };
}

export async function decryptTransaction(
  row: TransactionEncrypted,
  mek: CryptoKey,
): Promise<TransactionPlain> {
  const tagsJson = await decOpt(row.enc_tags, mek);
  return {
    amount: await decryptText(row.enc_amount, mek),
    description: await decryptText(row.enc_description, mek),
    merchant: await decOpt(row.enc_merchant, mek),
    category_id: await decOpt(row.enc_category_id, mek),
    memo: await decOpt(row.enc_memo, mek),
    tags: tagsJson ? (JSON.parse(tagsJson) as string[]) : null,
    owner: await decOpt(row.enc_owner, mek),
  };
}

// ---------- categories ----------

export interface CategoryPlain {
  name: string;
  icon?: string | null;
  color?: string | null;
  parent_id?: string | null;
}

export interface CategoryEncrypted {
  enc_name: string;
  enc_icon: string | null;
  enc_color: string | null;
  enc_parent_id: string | null;
}

export async function encryptCategory(
  cat: CategoryPlain,
  mek: CryptoKey,
): Promise<CategoryEncrypted> {
  return {
    enc_name: await encryptText(cat.name, mek),
    enc_icon: await encOpt(cat.icon, mek),
    enc_color: await encOpt(cat.color, mek),
    enc_parent_id: await encOpt(cat.parent_id, mek),
  };
}

export async function decryptCategory(
  row: CategoryEncrypted,
  mek: CryptoKey,
): Promise<CategoryPlain> {
  return {
    name: await decryptText(row.enc_name, mek),
    icon: await decOpt(row.enc_icon, mek),
    color: await decOpt(row.enc_color, mek),
    parent_id: await decOpt(row.enc_parent_id, mek),
  };
}

// ---------- budgets ----------

export interface BudgetPlain {
  mode: "flex" | "category";
  data: Record<string, unknown>;
}

export interface BudgetEncrypted {
  enc_mode: string;
  enc_data: string;
}

export async function encryptBudget(bud: BudgetPlain, mek: CryptoKey): Promise<BudgetEncrypted> {
  return {
    enc_mode: await encryptText(bud.mode, mek),
    enc_data: await encryptText(JSON.stringify(bud.data), mek),
  };
}

export async function decryptBudget(row: BudgetEncrypted, mek: CryptoKey): Promise<BudgetPlain> {
  const mode = (await decryptText(row.enc_mode, mek)) as "flex" | "category";
  const data = JSON.parse(await decryptText(row.enc_data, mek)) as Record<string, unknown>;
  return { mode, data };
}

// ---------- goals ----------

export interface GoalPlain {
  name: string;
  type: "save_up" | "pay_down";
  target_amount: string;
  current_amount: string;
  target_date?: string | null;
  strategy?: "avalanche" | "snowball" | null;
  linked_account_ids?: string[] | null;
}

export interface GoalEncrypted {
  enc_name: string;
  enc_type: string;
  enc_target_amount: string;
  enc_current_amount: string;
  enc_target_date: string | null;
  enc_strategy: string | null;
  enc_linked_account_ids: string | null;
}

export async function encryptGoal(goal: GoalPlain, mek: CryptoKey): Promise<GoalEncrypted> {
  return {
    enc_name: await encryptText(goal.name, mek),
    enc_type: await encryptText(goal.type, mek),
    enc_target_amount: await encryptText(goal.target_amount, mek),
    enc_current_amount: await encryptText(goal.current_amount, mek),
    enc_target_date: await encOpt(goal.target_date, mek),
    enc_strategy: await encOpt(goal.strategy ?? null, mek),
    enc_linked_account_ids:
      goal.linked_account_ids && goal.linked_account_ids.length > 0
        ? await encryptText(JSON.stringify(goal.linked_account_ids), mek)
        : null,
  };
}

export async function decryptGoal(row: GoalEncrypted, mek: CryptoKey): Promise<GoalPlain> {
  const linkedJson = await decOpt(row.enc_linked_account_ids, mek);
  const strategy = await decOpt(row.enc_strategy, mek);
  return {
    name: await decryptText(row.enc_name, mek),
    type: (await decryptText(row.enc_type, mek)) as "save_up" | "pay_down",
    target_amount: await decryptText(row.enc_target_amount, mek),
    current_amount: await decryptText(row.enc_current_amount, mek),
    target_date: await decOpt(row.enc_target_date, mek),
    strategy: strategy as "avalanche" | "snowball" | null,
    linked_account_ids: linkedJson ? (JSON.parse(linkedJson) as string[]) : null,
  };
}
