# Project-specific and stale Skill lifecycle

## Applied

- Nine global Skills moved intact to a private `0700` quarantine with a `0600` rollback receipt; 9/9 sources are absent and 9/9 backups match their preflight hashes.
- ResearchWorkbench now owns sanitized `cls`, `cnstock`, and `data-connector-development` Skills. The retained Wind Skills were already project-owned; global/project comparison differed only in `scripts/update-state.json` state, which was not copied.
- ResearchWorkbench published the migration at `ad60a98e0e740335a75ab60968d53ba8f8be73ef`. Local acceptance ran 78 Node gates plus documentation governance, Python index, Project Constraints and diff checks; GitHub Project Constraints run `35820355882` completed successfully and the managed delivery/Harness cleanup gate passed.
- `multi-format-rag` was quarantined rather than copied: its 31.5 MB tree mixed Chroma databases, binary indexes, spreadsheets, caches, provider experiments and a dependency set. The private backup is retained.
- Stale `self-improving-agent`, user `skill-creator`, and `write-a-skill` were quarantined because current system/plugin capabilities supersede them and their active instructions contained broken references.

## Security boundary

The sanitizer excludes credentials, environment/config files, locks, logs, outputs, caches, Chroma state, binary indexes, SQLite and spreadsheets. It rejects a literal credential assignment in any included text file. No package was installed and no finance crawler/network command ran.

`zq` remains in the separate earlier quarantine. Its tree was not copied. Credential rotation and a provider redesign using the OS credential store remain external prerequisites.

## Context measurement

After the exact-duplicate batch, prompt input was 64,842 bytes / 153 `SKILL.md` references. After this project/stale batch it is 61,226 bytes / 138 references: another 3,616 bytes and 15 references removed. Against the original 67,993 / 184 baseline, the cumulative fixed-context change is -6,767 bytes (-9.95%) and -46 references.

These are static prompt measurements, not proof of lower task Token usage. Post-restart A/B remains required.
