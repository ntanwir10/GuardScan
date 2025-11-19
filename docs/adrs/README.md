# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for GuardScan - documentation of significant architectural and technical decisions made in the project.

## What are ADRs?

Architecture Decision Records (ADRs) are a lightweight way to document important architectural decisions along with their context and consequences. Each ADR describes:

- **Context**: What problem are we trying to solve?
- **Decision**: What did we decide to do?
- **Rationale**: Why did we make this decision?
- **Consequences**: What are the positive and negative outcomes?

## Index of ADRs

### Backend & Infrastructure

- [ADR 001: Cloudflare Workers for Backend](./001-cloudflare-workers-backend.md)
  - **Status**: Accepted
  - **Summary**: Use Cloudflare Workers for optional telemetry backend due to global performance, zero ops, and cost-effectiveness

- [ADR 002: Supabase PostgreSQL for Database](./002-supabase-postgresql.md)
  - **Status**: Accepted
  - **Summary**: Use Supabase PostgreSQL for telemetry storage due to REST API compatibility with Workers and excellent developer experience

### Architecture & Design

- [ADR 003: Privacy-First Architecture](./003-privacy-first-architecture.md)
  - **Status**: Accepted
  - **Summary**: All code analysis happens locally, source code never sent to servers, optional anonymized telemetry only

- [ADR 005: BYOK (Bring Your Own Key) AI Model](./005-byok-ai-model.md)
  - **Status**: Accepted
  - **Summary**: Users provide their own AI API keys for AI features, enabling privacy, cost control, and sustainability

### Development & Tooling

- [ADR 004: TypeScript Strict Mode](./004-typescript-strict-mode.md)
  - **Status**: Accepted
  - **Summary**: Enable TypeScript strict mode for maximum type safety and fewer bugs

## ADR Template

When creating a new ADR, use this template:

```markdown
# ADR NNN: [Short Title]

## Status
[Proposed | Accepted | Deprecated | Superseded by [ADR-NNN](./NNN-title.md)]

## Date
YYYY-MM-DD

## Context
What is the problem we're trying to solve?
What are the forces at play?
Why is this decision necessary?

## Decision
What did we decide to do?
Be specific and actionable.

## Rationale
Why did we make this decision?
What alternatives did we consider?
Why is this the best option?

## Consequences
### Positive
What are the benefits of this decision?

### Negative
What are the downsides or trade-offs?
How do we mitigate them?

## Implementation Details
How do we implement this decision?
What are the key technical considerations?

## Related Decisions
- Link to related ADRs

## References
- External documentation
- Research papers
- Blog posts

## Review
When should this decision be reviewed?
**Next review date**: YYYY-MM-DD
```

## Workflow

### Creating a New ADR

1. **Copy the template** above
2. **Assign a number**: Use the next sequential number
3. **Write the ADR**: Fill in all sections
4. **Get feedback**: Share with team for review
5. **Merge**: Once approved, merge into main branch
6. **Update index**: Add to this README

### ADR Lifecycle

1. **Proposed**: New ADR under discussion
2. **Accepted**: Team has agreed on the decision
3. **Deprecated**: Decision is outdated but kept for historical context
4. **Superseded**: Replaced by a newer ADR

### When to Write an ADR

Write an ADR when:
- Making a significant architectural decision
- Choosing between multiple valid alternatives
- The decision will be difficult to change later
- Future developers will ask "why did we do it this way?"

Don't write an ADR for:
- Obvious or trivial decisions
- Decisions that are easily reversible
- Implementation details (not architectural)

## Principles

1. **Document decisions, not requirements**: Focus on the "why" not the "what"
2. **Keep it concise**: ADRs should be readable in 5-10 minutes
3. **Write for future maintainers**: Assume no context about the project
4. **Be honest about trade-offs**: Document both pros and cons
5. **Date decisions**: Context changes over time
6. **Link related decisions**: Build a decision graph

## Benefits of ADRs

- **Knowledge preservation**: Decisions survive team changes
- **Onboarding**: New team members understand past decisions
- **Avoid revisiting**: Don't re-debate decided issues
- **Transparent**: Anyone can understand the rationale
- **Learning**: Reflect on decisions and their outcomes

## Resources

- [ADR GitHub Organization](https://adr.github.io/)
- [Joel Parker Henderson's ADR templates](https://github.com/joelparkerhenderson/architecture-decision-record)
- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [ADR Tools](https://github.com/npryce/adr-tools)

## Questions?

If you have questions about ADRs or need help writing one:
- Open a GitHub Discussion
- Ask in the team chat
- Refer to existing ADRs as examples

