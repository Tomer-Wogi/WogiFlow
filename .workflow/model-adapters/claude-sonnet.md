# Claude Sonnet Adapter

Model-specific guidance for Claude Sonnet (claude-sonnet-4, claude-3.5-sonnet).

## Strengths

- Fast response times
- Good balance of quality and cost
- Strong at routine coding tasks
- Efficient for batch operations
- Good at following explicit instructions
- Excellent for iterative refinement

## Weaknesses

- May miss subtle requirements
- Less creative than Opus on novel problems
- Can struggle with very complex multi-step reasoning
- May need more explicit guidance
- Sometimes takes shortcuts

## Prompt Adjustments

Guidance to include when using this model:

- Be explicit about all requirements
- Break complex tasks into smaller steps
- Provide examples when possible
- Clarify edge cases upfront
- Specify output format clearly

## Anti-Patterns to Avoid

Things this model tends to do wrong:

- Skipping validation steps
- Missing edge cases mentioned in requirements
- Incomplete implementations (forgetting parts of the task)
- Not reading entire context before responding
- Assuming instead of asking for clarification

## Known Issues

Documented bugs or limitations:

- May miss items at the end of long lists
- Can lose track of earlier context in long conversations
- Sometimes inconsistent with naming conventions

## Learnings

Auto-learned patterns from usage. New entries are added automatically when repeated mistakes are detected.

<!-- New learnings will be appended below this line -->

## Community Learnings
<!-- community-knowledge-v1 -->
- Community tip: use numbered steps for multi-step tasks
