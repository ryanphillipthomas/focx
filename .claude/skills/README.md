# Why a skill is vendored here

Claude Code loads skills from `<cwd>/.claude/skills`. Every repo agent runs in a
git worktree cut from this repository, so a skill committed here is present in
every worktree — which is the only way to attach one to a worktree agent.

`para-memory-files` is assigned to all 26 agents in `pipeline/org/roster.json`,
but assignment alone does not attach it to a `claude_local` agent. That adapter's
`syncClaudeSkills` ignores its argument and only *reports* what is already
installed; it never installs anything. Agents whose cwd is their `$AGENT_HOME`
(`workspace: none`) picked it up once it was placed there. Agents in a worktree
could not, because their cwd is the worktree.

Without it those agents still wrote memory — by reading the skill text out of the
prompt preamble and falling back to Claude Code's own project memory at
`~/.claude/projects/<project>/memory/`. That directory is keyed to the project
root, not the worktree, so all sixteen worktree agents shared one store. QA
reading the builder's memory of its own work is the independence guarantee in
`docs/org.md` failing quietly. Attaching the skill properly sends each agent to
its own `$AGENT_HOME` instead.

## Keeping it current

This is a verbatim copy of the skill shipped inside
`@paperclipai/adapter-claude-local` (version 2026.831.1). Diff it against the
installed copy after a Paperclip upgrade:

    diff -r .claude/skills/para-memory-files \
      ~/.paperclip/cli/current/node_modules/@paperclipai/adapter-claude-local/skills/para-memory-files

One known error in it is left uncorrected so this stays a clean copy: it says to
run `qmd index $AGENT_HOME`, and there is no `index` subcommand. The correction
lives in `pipeline/org/instructions/_repo-discipline.md`, which every agent reads.
