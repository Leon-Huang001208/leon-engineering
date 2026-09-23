# Skill Portfolio exact-duplicate batch

## Result

- Applied 25/25 checksum-approved retirements; 48 files and 124,447 logical bytes moved to a private rollback backup.
- Post-apply verification: 25 sources absent, 25 backups exact, 25 canonical trees exact.
- Backup directory mode is `0700`; receipt mode is `0600`. No backup was deleted.
- The seven Codex canonical roots are CC-Switch symlinks. The portfolio tool resolves only the canonical root link, then rejects any symlink inside the tree; sources must always be regular directories.

## Context measurement

`codex debug prompt-input` was redirected to a private temporary file and only counts/hash were read:

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Prompt characters/bytes | 67,993 | 64,842 | -3,151 (-4.63%) |
| `SKILL.md` references | 184 | 153 | -31 |

Post-apply prompt SHA-256: `18e5d460ad73f93dd85ada4b9995000e8dfc7734dc7e72a50b24affa1015cddd`.

This is fixed-context reduction, not proof of task Token savings. Promotion still requires the fixed post-restart A/B with correct answers, unchanged permissions/errors/tools, and all required gates.

## Rollback

The private receipt records every source, backup, canonical path, and tree hash. Rollback is accepted only when every backup and canonical tree still matches and every original source path remains absent. The repository intentionally records no user-specific backup path.
