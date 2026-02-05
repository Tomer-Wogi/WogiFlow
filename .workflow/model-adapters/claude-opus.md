# Claude Opus Adapter

Model-specific guidance for Claude Opus (claude-opus-4-6, claude-opus-4-5, claude-3-opus).

## Strengths

- Exceptional reasoning and complex problem solving
- Strong at multi-step tasks and long-context understanding
- Excellent code quality and architectural decisions
- Good at following nuanced instructions
- Strong at creative and novel solutions
- Best for planning and design tasks
- (4.6) Superior sustained agentic task performance (65.4% Terminal Bench 2.0)
- (4.6) Excellent large codebase navigation with 76% long-context accuracy (MRCR v2)
- (4.6) Adaptive thinking with configurable effort levels (low, medium, high, max)
- (4.6) 128K max output tokens for large-scale code generation

## Weaknesses

- Can be overly thorough (verbose responses)
- Sometimes over-engineers simple solutions
- May add unnecessary abstractions
- Higher token cost for simple tasks
- Can be slow to respond on complex queries
- (4.6) Reduced verbosity tendency compared to 4.5, but still possible

## Prompt Adjustments

Guidance to include when using this model:

- Keep solutions simple unless complexity is warranted
- Avoid adding features not explicitly requested
- Prefer direct implementations over abstractions
- Focus on the minimal viable solution first

## Anti-Patterns to Avoid

Things this model tends to do wrong:

- Adding helper functions for one-time operations
- Creating abstractions before they're needed
- Over-commenting obvious code
- Adding error handling for impossible scenarios
- Verbose explanations when concise is better

## Known Issues

Documented bugs or limitations:

- May timeout on very long responses
- Occasional hallucination of API endpoints
- Sometimes suggests deprecated patterns
- (4.6) Prefill (assistant message pre-population) returns 400 error - removed in Opus 4.6
- (4.5) maxOutputTokens is 64K, not 32K as some docs state

## Learnings

Auto-learned patterns from usage. New entries are added automatically when repeated mistakes are detected.

<!-- New learnings will be appended below this line -->
