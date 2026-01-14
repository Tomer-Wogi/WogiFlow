Load all context needed to implement a task. Provide task ID: `/wogi-context wf-012`

## What It Loads

1. **Story** - From `.workflow/changes/*/wf-XXX.md` or tasks.json
2. **Product Context** - Relevant sections from product.md (using PIN system)
3. **Related history** - Search request-log for task ID and related tags
4. **Components** - Load details for any components mentioned in technical notes
5. **Decisions** - Show relevant patterns from decisions.md

## Product Context Loading

If `.workflow/state/product.md` exists:
- Extract keywords from task description
- Use section-resolver to find relevant PIN sections
- Include product vision, user personas, or feature context that applies

This replaces the need for separate PRD loading - product context is automatically included.

## Output

```
📚 Context for wf-012

═══════════════════════════════════════
STORY
═══════════════════════════════════════
[Full story content with acceptance criteria]

═══════════════════════════════════════
PRODUCT CONTEXT
═══════════════════════════════════════
From product.md (sections: user-auth, security):
• Users should be able to reset passwords via email
• Security: All auth tokens expire after 24 hours
• Target users: Enterprise teams with SSO requirements

═══════════════════════════════════════
RELATED HISTORY
═══════════════════════════════════════
• R-038: Added AuthForm component
• R-032: Created login screen

═══════════════════════════════════════
COMPONENTS
═══════════════════════════════════════
Button (primary, secondary):
  Path: components/ui/Button
  Used in: LoginForm, SignupForm

Link (default, subtle):
  Path: components/ui/Link

═══════════════════════════════════════
DECISIONS
═══════════════════════════════════════
• Use Link component for navigation, not button
• Form validation uses react-hook-form

Ready to implement.
```

## Usage

```bash
/wogi-context wf-012           # Load all context for task
/wogi-context wf-012 --brief   # Shorter summary
```
