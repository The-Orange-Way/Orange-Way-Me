/**
 * @vitest-environment node
 *
 * OWM-T0215 — the bridge must report its non-throwing row failures without
 * forwarding wallet or transaction values to observability.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureMessageMock } = vi.hoisted(() => ({ captureMessageMock: vi.fn() }));

vi.mock("@/lib/observability/sentry", () => ({
  captureMessageWithoutBreadcrumbs: captureMessageMock,
}));

import { importOrTransactions, type OrImportTransaction } from "@/lib/orImportBridge";

const baseTx: OrImportTransaction = {
  id: "private-transaction-id",
  direction: "in",
  type: "deposit",
  amount: 12.5,
  currency: "USD",
  description: "private decrypted label",
  counterparty: "private counterparty",
  timestamp: "2026-05-14T12:00:00Z",
  source_wallet_id: "private-source-wallet-id",
};

describe("importOrTransactions observability", () => {
  beforeEach(() => {
    captureMessageMock.mockReset();
  });

  it("reports fixed codes and counts without transaction values or raw errors", async () => {
    const rawError = new Error("private plaintext from encryption failure");
    const onError = vi.fn();

    const result = await importOrTransactions(
      "allowed-connection-id",
      [
        { ...baseTx, timestamp: "not-a-date" },
        { ...baseTx, id: "second-private-transaction-id" },
      ],
      {
        // No row reaches Supabase because one date is invalid and encryption
        // throws for the other row.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: {} as any,
        userId: "private-user-id",
        encryptText: async () => {
          throw rawError;
        },
        resolveAccountIds: () => ["private-account-id"],
        onError,
      },
    );

    expect(result.errored).toBe(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).toHaveBeenCalledWith("OR import bridge reported row failures", {
      level: "warning",
      tags: {
        area: "or-import-bridge",
        failureCodes: "invalid_date,row_build_failed",
      },
      extra: {
        connectionId: "allowed-connection-id",
        failureCounts: { invalid_date: 1, row_build_failed: 1 },
      },
    });

    const event = JSON.stringify(captureMessageMock.mock.calls[0]);
    for (const forbidden of [
      "private-transaction-id",
      "private-source-wallet-id",
      "private-account-id",
      "private-user-id",
      "private decrypted label",
      "private counterparty",
      rawError.message,
      "12.5",
    ]) {
      expect(event).not.toContain(forbidden);
    }
  });

  it("does not emit an event for a batch with no bridge failures", async () => {
    await importOrTransactions("allowed-connection-id", [], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: {} as any,
      userId: "private-user-id",
      encryptText: async (value) => value,
      resolveAccountIds: () => [],
    });

    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
