# Optional source-command plugin

## Packaging

- `leon-engineering-commands` packages 42 one-file `source-command-*` wrappers behind an optional plugin; it is present in the local marketplace source but is not installed/enabled by this migration.
- Ten wrappers map to an available specialized agent (`cpp-*`, Flutter build/review, Go build/review, Kotlin build, Python review, Rust build/review). The other 32 are self-contained wrapper workflows and map to their own unique packaged Skill.
- `source-command-hello` is retired as a placeholder. `source-command-jira` is quarantined because the referenced `jira-integration` capability is not installed. Neither is advertised as working.
- The private migration moved 42 exact packaged copies plus the two explicit quarantines into a `0700` backup with a `0600` receipt. All 44 source paths were hash-pinned before the batch.

## Validation

- Catalog tests parse both plugin manifests, require version `0.19.3`, match all 42 command-map entries to the 42 Skill directories, validate each Skill frontmatter name/description, and assert the two excluded wrappers.
- JSON manifests parse successfully and `git diff --check` is clean.
- The system plugin/Skill Python validators could not run because PyYAML is not installed. No dependency was installed; this remains an explicit validation limitation.

## Context measurement

Static prompt input after project/stale Skill quarantine was 61,226 bytes / 138 `SKILL.md` references. After moving source commands out of global discovery it is 53,617 bytes / 93 references, with prompt SHA-256 `07cb24c66e70e54b7d06a610edf4e0b80e84574d0b5b95e4074a3b0069242ea7`.

Against the original 67,993 / 184 baseline, cumulative fixed context is down 14,376 bytes (-21.14%) and 91 Skill references. This is not a task-level Token claim; the plugin stays disabled pending post-restart A/B.
