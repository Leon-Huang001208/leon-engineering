# Leon Engineering Commands (Retired)

This is a retired metadata-only compatibility package. Its plugin ID and version remain available for historical references; it declares no Skills, agents, hooks or MCP servers. All 42 legacy `source-command-*` Skill wrappers have been removed. `command-map.json` keeps their names, retirement reasons and replacement references, while `commands` is empty and the existing quarantined names are preserved.

Use the six core Skills on demand: `agent-routing`, `engineering-work`, `engineering-delivery`, `project-onboarding`, `project-constraints` and `project-harness`. Begin ordinary engineering work with `agent-routing`; implementation and diagnosis use the existing `engineering-work` references, and review and delivery use `engineering-delivery`.

The five optional workflows remain opt-in: `problem-framing`, `solution-comparison`, `evidence-and-experiments`, `logging-observability` and `skill-health`. The current `skill-health` workflow covers Skill governance; it does not recreate the old command's dashboard or missing legacy executor.

Useful language, testing, cleanup, documentation and learning methods are compressed into existing core references. A replacement path identifies reading material, not an alias that executes the retired command. `replacement: "none"` means there is no framework command replacement: ordinary side questions use the native conversation, while legacy updater, package-manager, instinct, hookify and session commands depended on separate systems that this package does not supply.

Retirement changes the source distribution only. It does not delete historical session records, migrate user Skills, update installed caches, enable optional workflows, or modify project runtimes. Use the host's native conversation history and the project's existing handoff process for session continuity. The discovery planner considers only active core and workflow roots; similarly named user Skills are outside this retirement change.
