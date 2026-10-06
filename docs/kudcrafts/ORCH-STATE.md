# ntfy fork rollout — orchestrator state

## Done (2026-10-06)
- ntfy v2.28.0 live at https://ntfy.kudcrafts.com (Coolify service `ntfy`, infra project). Creds: ~/.cache/tmp/ntfy-rollout/creds.env (scratch! move to secrets store).
- Merged + deployed: trading-backoffice#605 (ntfy channel), typemap#7, datacuan#7, facemap#116. GlitchTip + Coolify send to ntfy.
- board slugs renamed fm→facemap, tm→typemap in prod; board#4 (old-URL redirect) open, NOT merged.
- hammas account has 11 synced web subscriptions. Android backup import file: ~/.cache/tmp/ntfy-rollout/ntfy-android-hammas.json (untested).
- Forks: KudcraftsHQ/ntfy, KudcraftsHQ/ntfy-android (upstream remote set); cloned with ntfy-bar to ~/Projects.

## In progress
- Spec done: docs/kudcrafts/catalog-spec.md (4 clients incl. ntfy-bar-windows). On Readback: slug ntfy-catalog-spec, awaiting review.

## Next
- Push spec to Readback; then 3 opus builders (server+web, android, ntfy-bar) → PRs, no merge.
- Open: TypeMap not on Coolify; ntfy.sh upstream forwarding on (turn off?); partner read-only account.
