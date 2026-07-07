-- Seed the founder's own email addresses onto the beta allowlist so Miguel
-- can sign up on any environment during the private beta.
--
-- Idempotent: ON CONFLICT on LOWER(email) updates the note, so re-running is
-- safe and re-seeding an address that was removed simply restores it.
--
-- miguel@orangeway.app was already seeded by 20260625130000. It is repeated
-- here intentionally, as a belt-and-suspenders guarantee it is present, per
-- the founder's request to make sure it is on the list.

INSERT INTO public.beta_allowlist (email, note)
VALUES
    ('miguel@abascal.ca', 'Founder personal email; seeded on request 2026-07-07.'),
    ('miguel@orangeway.app', 'Founder; reaffirmed present 2026-07-07.')
ON CONFLICT ((LOWER(email))) DO UPDATE
    SET note = EXCLUDED.note;
