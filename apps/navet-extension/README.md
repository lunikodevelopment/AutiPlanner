# Navet extension boundary

This directory contains AutiPlanner-owned notes, fixtures, and (if useful later) provider-neutral prototype code for the Navet experience. It does not vendor Navet itself.

For actual Navet source changes, work in a Navet fork or patch branch and follow `docs/NAVET_INTEGRATION.md` plus upstream agent/design guidance.

## Desired widget contract

Input: a list of normalized routine items plus mutation commands.

Output: accessible date/day-part sections with four visible states:

- `○` pending
- `✓` completed
- `✕` missed
- `—` skipped

Do not make the shared widget parse ICS or issue raw Home Assistant service payloads.
