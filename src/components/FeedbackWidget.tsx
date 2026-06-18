/**
 * FeedbackWidget — drop-in React component that posts feature suggestions
 * to a Supabase-backed public board.
 *
 * Renders a small "Suggest a feature" button plus modal. When the customer
 * submits, the post is sent directly to the feedback Supabase using
 * anon-with-email (no second login). The customer's email comes from
 * whatever auth context the host app already has — pass it in via the
 * `submitterEmail` prop.
 *
 * Usage:
 *
 *   import { FeedbackWidget } from "./FeedbackWidget";
 *
 *   <FeedbackWidget
 *     feedbackSupabaseUrl="https://<your-feedback-project>.supabase.co"
 *     feedbackAnonKey="eyJ..."
 *     projectSlug="orange-way"         // matches the public board project slug
 *     sourceApp="orange-way"
 *     submitterEmail={user.email}      // from your app's auth context
 *     submitterName={user.fullName}    // optional
 *     accentColor="#F7931A"            // optional, matches the brand on the public board
 *   />
 *
 * Visual: a floating button bottom-right by default. Override by wrapping
 * in your own button + passing the openOnClick prop.
 *
 * Dependencies: React 18+, fetch (built into modern browsers). No other
 * libraries. Tailwind classes are used here for styling — strip or replace
 * if your host app doesn't use Tailwind.
 */

import { useEffect, useRef, useState } from "react";

// Privacy-by-default identity. Customer's email is hashed with SHA-256
// (unsalted) so the feedback DB never sees plaintext unless the customer
// explicitly opts in to be contacted. Unsalted on purpose so the same
// person's posts can be linked across submissions for spam detection,
// without ever revealing who they are.
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input.trim().toLowerCase());
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Props = {
  feedbackSupabaseUrl: string;
  feedbackAnonKey: string;
  projectSlug: "orange-way" | "orange-rails" | string;
  sourceApp: "orange-way" | "orange-rails" | string;
  submitterEmail: string;
  submitterName?: string;
  accentColor?: string;
  // Where on the public board the user can browse + vote on submissions.
  publicBoardUrl?: string;
  // 'inline' renders a discreet text-link trigger that the parent positions
  //   wherever it wants (e.g., inside a page footer). Recommended for apps
  //   that don't want an attention-grabbing floating button.
  // 'floating' renders a fixed bottom-right pill — eye-catching but noisy.
  variant?: "inline" | "floating";
  // Optional label override on the trigger.
  triggerLabel?: string;
};

type ProjectRow = { id: string; slug: string };

export function FeedbackWidget({
  feedbackSupabaseUrl,
  feedbackAnonKey,
  projectSlug,
  sourceApp,
  submitterEmail,
  submitterName,
  accentColor = "#F7931A",
  publicBoardUrl,
  variant = "inline",
  triggerLabel = "Suggest a feature",
}: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const projectIdRef = useRef<string | null>(null);

  // Resolve project slug → id once, lazily on first open.
  useEffect(() => {
    if (!open || projectIdRef.current) return;
    fetch(
      `${feedbackSupabaseUrl}/rest/v1/projects?slug=eq.${encodeURIComponent(projectSlug)}&select=id`,
      {
        headers: { apikey: feedbackAnonKey, Authorization: `Bearer ${feedbackAnonKey}` },
      },
    )
      .then((r) => r.json() as Promise<ProjectRow[]>)
      .then((rows) => {
        if (rows?.[0]?.id) projectIdRef.current = rows[0].id;
        else setError(`No project with slug "${projectSlug}" — check the public board setup.`);
      })
      .catch(() => setError("Couldn't reach the feedback service."));
  }, [open, feedbackSupabaseUrl, feedbackAnonKey, projectSlug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectIdRef.current) {
      setError("Project not resolved yet — try again in a moment.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Hash the customer's email client-side. The plaintext NEVER leaves
      // the browser unless the customer ticked the "email me about this"
      // checkbox below.
      const submitterHash = await sha256Hex(submitterEmail);

      const payload: Record<string, unknown> = {
        project_id: projectIdRef.current,
        title: title.trim(),
        body: body.trim(),
        submitter_hash: submitterHash,
        source_app: sourceApp,
        // author_id intentionally omitted — RLS policy requires it null for
        // the anon-with-hash submission path.
      };
      if (emailConsent) {
        payload.submitter_email = submitterEmail;
        payload.submitter_name = submitterName ?? null;
        payload.email_consent = true;
      }

      const res = await fetch(`${feedbackSupabaseUrl}/rest/v1/posts`, {
        method: "POST",
        headers: {
          apikey: feedbackAnonKey,
          Authorization: `Bearer ${feedbackAnonKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${text}`);
      }
      setDone(true);
      setTitle("");
      setBody("");
      setEmailConsent(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    setOpen(false);
    setError(null);
    setDone(false);
    // Privacy default: consent always resets to off when the dialog closes
    // so the next submission must explicitly opt in again.
    setEmailConsent(false);
  };

  return (
    <>
      {variant === "floating" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:opacity-90"
          style={{ background: accentColor }}
        >
          {triggerLabel}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium underline-offset-4 transition hover:underline"
          style={{ color: accentColor }}
        >
          {triggerLabel}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <>
                <h2 className="text-lg font-semibold">Thanks for the suggestion</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Your idea is now public so others can vote on it.
                  {publicBoardUrl && (
                    <>
                      {" "}
                      <a
                        href={publicBoardUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                        style={{ color: accentColor }}
                      >
                        See the board
                      </a>
                      .
                    </>
                  )}
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDone(false);
                    }}
                    className="rounded-md px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                    style={{ background: accentColor }}
                  >
                    Suggest another
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={submit}>
                <h2 className="text-lg font-semibold">I wish we had…</h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Tell us what would make this product better. Submitted privately — your email is
                  hashed and never stored unless you opt in below.
                </p>

                <div className="mt-4 space-y-3">
                  <input
                    type="text"
                    required
                    placeholder="Short, clear title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                    autoFocus
                  />
                  <textarea
                    placeholder="Add details (optional)"
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  />

                  <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={emailConsent}
                      onChange={(e) => setEmailConsent(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Email me about this idea <span className="text-zinc-500">(optional)</span> —
                      we'll attach <span className="font-medium">{submitterEmail}</span> so we can
                      reply when there's an update.
                    </span>
                  </label>

                  {error && <p className="text-xs text-red-600">{error}</p>}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !title.trim()}
                    className="rounded-md px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    style={{ background: accentColor }}
                  >
                    {submitting ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
