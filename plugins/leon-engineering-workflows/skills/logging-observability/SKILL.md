---
name: logging-observability
description: Use when adding or revising application logging, error taxonomy, correlation fields, redaction, retention, or operational diagnostics.
---

# Logging Observability

First inspect the project's logging library, conventions, operational environment, and retention policy. Preserve the existing structured logger unless a replacement is explicitly authorized.

Define event names, levels, correlation fields, actionable error categories, and ownership. Redact credentials, tokens, personal data, raw request bodies, and sensitive paths. Do not turn normal control flow into error logs or require every function to catch exceptions.

Add focused tests or safe local verification for emitted structured fields and redaction. Hand off observability changes, sampled evidence, retention assumptions, and unresolved production-only risks.
