# Deliberate test marker (OWM-T0660 step 8)

This file exists only to make `automation/backmerge-prod-to-dev` diverge from
`prod` by one commit that prod does not have, on purpose, so the next prod
push exercises the self-heal path in `.github/workflows/prod-backmerge.yml`
(the "Assert automation branch is an ancestor of prod" step).

No open pull request depends on this branch. The next prod push should
delete this branch automatically and recreate it at the new prod tip,
logging the discarded sha. If that happens, this file is gone with it and
nothing further is needed. If the guard instead fails loudly naming an open
PR, something unexpected created a PR from this branch and a human should
look before deleting anything by hand.

Committed by Release, tracked on OWM-T0660 (step 8).
