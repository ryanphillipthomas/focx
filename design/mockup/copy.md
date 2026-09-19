# Focx Bot mockup — verbatim copy

Every user-facing string in the mockup, transcribed exactly from `source/app.js` and
`source/index.html`. Curly quotes, ellipses and middot separators are reproduced as authored.

`{bot}`, `{name}`, `{n}` etc. mark runtime interpolation. Where a string is a ternary, both
branches are given.

---

## Global chrome

**Window title bar**
- `Focx Bot / Your little team of big thinkers` (the `/` is a separately styled `.title-divider`)
- Badge: `Interactive demo`

**Document title** — `Focx Bot — {The den | Inbox | Tasks | Routines | Connections | Settings | {bot name}}`

**Meta description** — `Meet your little team of big thinkers. Focx Bot is an interactive desktop AI teammate mockup.`

**Sidebar**
- Brand: `focx bot` (`bot` in italic `<em>`)
- Search button: `Find anything` · kbd `⌘ K`
- Nav: `The den` · `Inbox` · `Tasks` · `Routines`
- Section label: `YOUR BOTS`
- Bottom nav: `Connections` · `Settings`
- Workspace switcher: `Focx workspace` / `Ryan’s personal den`

**Toolbar**
- Breadcrumb: `Workspace` › `{view title}`
- Secondary button: `Talk to Focx` (all views) → `Open computer` (chat view)
- Primary button: `New bot` → `New task` (tasks view) → `New routine` (routines view)

**Status bar**
- Left: `The den is humming` / when paused: `The den is taking a breather`
- Middle: `Focx workspace · Demo data`
- Right: `Quick switch` · kbd `⌘ K`

---

## The team (6 bots)

| Name | Role | Status | Doing | Model |
|---|---|---|---|---|
| Focx | Chief of Staff | working | Keeping things moving | Claude |
| Byte | Developer | working | Building onboarding | Codex |
| Pixel | Designer | waiting | Needs your feedback | Claude |
| Bloom | Growth | working | Planning the launch | Claude |
| Patch | Quality Assurance | idle | All checks passed | Claude |
| Scout | Researcher | working | Exploring opportunities | Claude |

**Bios** (shown in the right panel, and in each bot's first message)

- **Focx** — `The big-picture thinker with a soft spot for a good checklist. I keep your team focused on launching Connect.`
- **Byte** — `Coffee optional. Clean code essential. I turn your team’s ideas into working product experiences.`
- **Pixel** — `Equal parts systems thinker and pixel perfectionist. I keep Connect feeling unmistakably Focx.`
- **Bloom** — `Small experiments, meaningful growth. I help the right people discover and fall in love with Connect.`
- **Patch** — `Your lovingly skeptical teammate. I check the details, find the edge cases, and give every release a second look.`
- **Scout** — `Curiosity is my favorite skill. I bring the useful findings back to the den, with sources and a point of view.`

---

## Screen 1 — The den

- Eyebrow: `GOOD EVENING, RYAN`
- H1: `The den`
- Sub: `Good things happen when your team clicks.`
- Live tag: `{n} bots working` / when paused: `Activity paused`
- View toggle: `Team` · `Company` · `List`
- Section label: `{n} teammates. One direction.`
- Den topline (left): `FOCX / TEAM PRESENCE` → `FOCX / COMPANY VIEW` in company mode
- Den topline (right): `A little hive of activity` / when paused: `Taking a breather`
- Den caption: `Click a teammate to see what they’re up to`

**Team summary strip**
- `Tasks completed` → `{n}` / `Good progress`
- `In motion` → `{n}` / `Across your team`
- `Needs your eye` → `{n}` / `Ready to review`

**Composer (team mode)**
- Placeholder: `Give your team something to do…`
- Target label: `Focx` / `Chief of Staff`
- Hint: `A little direction goes a long way.` `Enter to send · Shift + Enter for a new line`

---

## Screen 2 — Chat

- Header: `{bot name}` / `{role} / {model}`
- Live tag: working → `On it` · waiting → `Ready for you` · idle → `Available`
- Date divider: `TODAY · DEMO CONVERSATION`
- Typing indicator: `{bot name} is thinking…`
- Composer placeholder: `Message {bot name}…`
- Attachment card sub-label: `Draft · Ready for review`

**Opening message — Focx**
```
Hey Ryan. The den’s in a good place.

Byte is bringing the Connect welcome flow to life, Scout has a few interesting launch leads, and Pixel has something ready for your eye.

Want the quick rundown, or shall we get something moving?
```

**Opening message — every other bot**
```
Hey Ryan, {name} here. {bio}

{status line}
```
where *status line* is:
- waiting → `I have a new welcome flow ready for your feedback. Want to take a look?`
- idle → `The last quality pass is complete. What should I take a look at next?`
- working → `Right now I’m {doing, lowercased}. What can I help you with?`

**Suggestion chips** (first message only)
`Give me a quick update` · `What needs my attention?` · `Plan the next steps`
(the third chip sends the longer prompt `Plan the next steps for Connect`)

### Scripted replies

**Greeting / thanks** — matches `hello|hi|hey|thanks|thank you`
```
{Hey Ryan. Good to see you in the den. | You’re welcome, Ryan.} A small team can do a lot with a little direction.

I can share a status update, help you review a draft, or queue a task. What’s on your mind?
```

**Review request** — matches `attention|review|approve|feedback|draft`
```
{bot} has “{title}” ready.

{description}

Open the draft below to approve it or send feedback. There {is|are} {n} pending {review|reviews} in your inbox.
```
Nothing pending:
```
You’re all caught up. No reviews are waiting on you.

The next useful move is to pick one task from the queue and give it a clear finish line.
```

**Status request** — matches `status|update|rundown|happening|progress`

From Focx:
```
Here’s the pulse of the den:

{Name} — {doing}.   (one line per non-Focx bot)

{n} tasks done, {n} in motion, and {n} ready for your review. We’re keeping the focus on Connect.
```
From any other bot:
```
Here’s my corner of the den: {doing, lowercased}.

• {task title} — {complete | in progress | queued}

Tell me what you’d like me to take on next.
```
With an empty queue, the bullet list is replaced by `My queue is clear. Ready for your next idea.`

**Routine request** — matches `routine|every day|daily|weekly|every morning`
```
That sounds like a good rhythm for the team. Open Routines to choose a teammate, a schedule, and a clear prompt.

For Connect, I’d start with a morning brief: what shipped, what’s blocked, and the three decisions that need you.

Schedules here are part of the mockup; nothing runs in the background.
```

**Planning request** — matches `next step|priorit|plan`
```
I’d keep the next steps small and connected:

1. Review Pixel’s welcome-flow draft.
2. Let Byte build the approved direction.
3. Have Patch check the complete first-use experience.
4. Ask Bloom and Scout to prepare a focused launch experiment.

One polished path from “hello” to a meaningful first action. That’s a good next milestone.
```

**With the brief attached**
```
I’ve got the Connect team brief. It covers a focused welcome flow, consistent Focx components, and a thoughtful launch.

I’d start by resolving Pixel’s welcome-flow review, then hand that direction to Byte. Want to review the draft?
```

**Fallback — anything else becomes a task**
```
{I’ve added this to my queue | I’ve put {Name} on this}:

“{title}”

You’ll find it on the task board as FCX-{id}. Set its status to “In motion” when you’re ready.

This is a demo handoff — the task is queued in the mockup, without running an external agent.
```

---

## Right panel — Happening now (all views except chat)

- H2: `Happening now`
- H2: `A little nudge` · `{n} pending`
- Pending card: `Waiting on your good judgment` / `{approval title}` / `{bot} has something ready for you.` / button `Take a look`
- **Empty state:** `You’re all caught up` / `The team has what it needs. Nice.`
- H2: `The daily pulse` · `Sample day`
- Stat: `24` `little wins from the team`
- Chart axis: `9 AM` · `12 PM` · `3 PM` · `Now`
- Footer note: `Big ideas. Small steps.` / `A team that’s in your corner.`

**Seed activity feed**
| Bot | Text | Time | Chip |
|---|---|---|---|
| Byte | Bringing the Connect welcome flow to life. | Just now | welcome-flow.tsx |
| Scout | Found 3 communities worth exploring for launch. | 2m ago | Research notes |
| Pixel | The new welcome screens are ready for you. | 6m ago | 3 screens to review |
| Patch | Connection reminders passed the quality check. | 12m ago | All checks passed |

**Rotating demo events** (one every 24s, only while that bot is `working`)
- Byte — `Checking the welcome flow against the brief.` / `Working notes`
- Scout — `Organizing the launch research into a shortlist.` / `Research notes`
- Bloom — `Shaping a small, focused launch experiment.` / `Launch plan`
- Focx — `Keeping the next steps in a sensible order.` / `Team priorities`

---

## Right panel — Bot detail (chat view)

- H2: `{bot}’s computer`
- Note: `A peek at what {bot} is working on.`
- `A LITTLE ABOUT {BOT NAME}` → bio
- `IN THE TOOLBOX` → pills: `{role}` · `Browser` · `Working memory`
- `LEARNED SKILLS` (only after a skill is taught)
- Button: `Teach a skill`
- `UP NEXT` → up to 2 open tasks, sub-label `In progress` / `In the queue`
- **Empty state:** `A little breathing room. Send a new task.`
- Footer button: `Give a break` / when idle: `Wake up`

**Simulated computer**
- Chrome label: `{bot, lowercased}@focx · workspace`
- Terminal label: `{bot} / {connect | design-studio | research | workspace}`
- Byte's screen:
  ```
  // A warm welcome to Connect
  export function Welcome() {
      return (
        <WelcomeFlow
         theme="focx"
        />
      );
  }
  ```
- Everyone else:
  ```
  ✓ Team context loaded
  ✓ Connect priorities reviewed
  ✓ {Design components checked | Quality checklist complete | Working notes organized}

  {doing}…
  ```
- Status line: `Demo workspace` / `Simulation paused` / `Control handed to you`
- Controls: `Simulated computer` / `You have control`; button `Expand` → `Take control` → `Hand back`

---

## Screen 3 — Tasks

- Eyebrow: `THE TASK BOARD`
- H1: `Little steps. Real progress.`
- Sub: `Everything your team is moving forward.`
- Columns: `Up next` · `In motion` · `All done`
- Card: `FCX-{id}` / `{title}` / `{bot}` / `Priority` badge on high-priority items
- **Empty column state:** `A clear little corner.` / `Ready for what’s next.`
- Note: `Move a task with its status menu. This demo keeps your changes until you reload.`

**Seed tasks**

| ID | Title | Bot | Status | Priority |
|---|---|---|---|---|
| 108 | Explore Connect referral ideas | Scout | todo | Normal |
| 109 | Draft the launch announcement | Bloom | todo | High |
| 104 | Build the welcome flow | Byte | doing | High |
| 105 | Refine the person profile | Pixel | doing | Normal |
| 106 | Map the first launch channels | Bloom | doing | Normal |
| 101 | Review connection reminders | Patch | done | Normal |
| 102 | Summarize the customer interviews | Scout | done | Normal |
| 103 | Plan this week’s priorities | Focx | done | Normal |

---

## Screen 4 — Inbox

- Eyebrow: `YOUR INBOX`
- H1: `A second pair of eyes.`
- Sub: `A few things are better with your good judgment.`
- Tag: `{n} to review`
- Card eyebrow: `{BOT NAME} · {LABEL, UPPERCASED}`
- Buttons: `Open draft` · `Approve`
- Resolved: `Approved · Team notified in this demo` / `Feedback sent · Back with the team`
- Note: `Approvals update the mockup. No messages, designs, or code are published.`

### Approval 1 — Pixel, *Design review*
**`A fresh welcome for Connect`**
`The welcome flow is ready for a look. Three focused screens, the existing Focx components, and a little more personality.`

Document `Connect · Welcome flow`:
```
1. Welcome to Connect
A calm introduction: “Make a little room for your people.” One primary action: Add your first person.

2. Start with someone
Name and relationship are enough to begin. Additional context can come later.

3. Your first small step
Choose a thoughtful check-in or set a reminder. No contact upload required.

Review focus: clarity, consistent components, accessible contrast, and a comfortable first action.
```

### Approval 2 — Bloom, *Copy review*
**`Your first launch announcement`**
`A short, human introduction to Connect. Ready for your review before anything goes out.`

Document `Connect · Launch announcement`:
```
Some relationships don’t need a grand gesture. Just a little more attention.

Meet Connect by Focx. A thoughtful place to remember the little things, follow through, and make room for the people who matter.

We’re starting small, listening closely, and building with you.

Get to know Connect.

Draft only. Review the invitation link, audience, and product availability before publishing.
```

### Approval 3 — Focx, *Plan review*
**`This week’s priorities, all lined up`**
`A small, focused plan for product, design, and growth. Give the team a direction.`

Document `Connect · Team priorities`:
```
1. Product
Byte completes the welcome flow. Patch checks keyboard navigation, mobile layout, and failure states.

2. Design
Pixel aligns the person profile and welcome screens with the Focx design system.

3. Growth
Bloom drafts the launch announcement. Scout identifies three communities where Connect is a natural fit.

Your decision
Review the welcome flow first. It is the dependency for the next product demo.
```

---

## Screen 5 — Routines

- Eyebrow: `ROUTINES`
- H1: `A rhythm of their own.`
- Sub: `Good habits for a team that keeps things moving.`
- Card meta: `{schedule} · {bot}` — plus `· Paused` when disabled
- Button: `Give the team a new rhythm`
- Note: `Routine schedules are simulated. They won’t run outside this mockup.`

| Routine | Prompt | Schedule | Bot | On |
|---|---|---|---|---|
| A good morning, on autopilot | Summarize what the team shipped, flag blockers, and suggest my top three priorities. | Every weekday · 8:00 AM | Focx | yes |
| The nightly quality patrol | Review completed development tasks and prepare a quality report for the morning. | Every day · 11:00 PM | Patch | yes |
| A little competitive curiosity | Find relevant product updates and three useful growth opportunities for Connect. | Every Monday · 9:00 AM | Scout | no |

---

## Screen 6 — Connections

- Eyebrow: `CONNECTIONS`
- H1: `A well-stocked toolbox.`
- Sub: `Your team’s favorite places to get things done.`
- Button: `Connected in demo` / `Connect in demo`
- Note: `These are demo connections. No external accounts or services are accessed.`

| Tool | Description | State |
|---|---|---|
| GitHub | Repos, pull requests, and all the little details. | connected |
| Figma | A shared home for design and visual thinking. | connected |
| PostHog | Turn product signals into better decisions. | not connected |
| Browser | A window to research, tools, and the wider web. | connected |

---

## Screen 7 — Settings

- Eyebrow: `PREFERENCES`
- H1: `Make yourself at home.`
- Sub: `Small adjustments for your corner of the internet.`

| Row | Description | Control |
|---|---|---|
| A little personality | Let your foxes bob, breathe, and do their thing. | switch |
| Live demo activity | Rotate the simulated feed while you explore. | switch |
| Workspace | Focx · Ryan’s personal den | tag `Interactive demo` |
| A fresh start | Reload the original team, tasks, and conversations. | `Reset demo` |

- Note: `Built as a browser-based desktop mockup. Chat replies, computers, and agent activity are simulated.`
- Link button: `About Focx Bot`

---

## Modals

### Search (⌘K)
- Title: `Find your way.`
- Placeholder: `A teammate, task, or place…`
- Result sub-label for tasks: `FCX-{id} · {bot}`
- **Empty state:** `No matches yet. Try a teammate’s name or a task.`

### New bot
- Title: `A new face in the den.`
- Intro: `A name, a specialty, a little personality. Your next teammate starts here.`
- Fields: `Pick a personality` · `Name` (`e.g. Ember`) · `What’s their specialty?` (`e.g. Customer happiness`) · `Model` (`Claude` / `Codex` / `Grok`)
- Submit: `Welcome to the team`
- Generated bio: `I’m {name}, your {role, lowercased} teammate. I’m ready to help move Connect forward, one thoughtful step at a time.`
- Generated status: `Ready for a little adventure`

### New task
- Title: `Give a good idea a nudge.`
- Intro: `What should the team take on next?`
- Fields: `Task` (`e.g. Plan a thoughtful launch for Connect`) · `Who’s on it?` · `Priority` (`Normal` / `High`)
- Submit: `Add to the queue`

### New routine
- Title: `Give it a rhythm.`
- Intro: `Set up a sample routine for your team. Schedules are for this demo only.`
- Fields: `Name` (`e.g. Friday’s little victories`) · `What should happen?` (`Summarize what we shipped and what we learned…`) · `Teammate` · `Schedule`
- Submit: `Create demo routine`

### Review draft
- Title: the document name, e.g. `Connect · Welcome flow`
- Meta: `{bot} · {label} · Ready for your thoughts`
- Buttons: `Looks good` · `Send feedback` · `Download draft`

### Send feedback
- Title: `A little direction.`
- Intro: `What would you like {bot} to change?`
- Placeholder: `Keep the calm tone, but make the first action clearer…`
- Submit: `Send demo feedback`
- Bot's reply: `Thanks, Ryan. I’ve captured that direction in our demo conversation. I’ll use it as the brief for the next pass.`

### Teach a skill
- Title: `Teach {bot} a skill.`
- Intro: `Write a reusable instruction for your teammate. Saved in this demo session.`
- Fields: `Skill name` (`e.g. Write in the Focx voice`) · `How should it work?` (`Use a warm, thoughtful tone. Keep it clear and human…`)
- Submit: `Save the skill`
- Detail note: `Saved for {bot} in this demo session.`

### Learned skill detail
- Title: the skill name as saved
- Body: the instructions as written
- Note: `Saved for {bot} in this demo session.`

### Choose a chat target
- Title: `Who’s on your mind?`

### Bot's computer (expanded)
- Title: `{bot}’s computer`
- Note: `A simulated workspace. Take control to try the handoff interaction.`
- After taking control: `Try a local demo command` (`Try: status, help, or ls`) · `Run demo command`
- After handing back: `The bot has the wheel again.`
- Command replies:
  - `help` → `Try status to check the workspace, or ls to see the sample files.`
  - `status` → `Workspace ready. You have control. This computer is simulated.`
  - `ls` → `connect-brief.md    team-priorities.md    welcome-flow.tsx`
  - anything else → `Demo command not found. Try help, status, or ls.`

### Workspace
- Title: `Your corner of the internet.`
- Body: `Focx workspace · Ryan’s personal den`
- Card: `{n} teammates, one direction.` / `Connect is the team’s focus. Product, design, research, growth, and quality — all in one little den.`
- Button: `Back to the den`

### About
- Title: `Meet Focx Bot.`
- Intro: `A playful desktop home for your AI teammates.`
- Card: `Small team. Big thinkers.`
- Body: `Chat with a fox, assign a task, review a draft, or peek at a bot’s computer. Your changes stay in this browser session and reset when the page reloads.` / `All conversations, activity, schedules, and connections are simulated. No real AI service is connected.`
- Note: `Interaction inspiration: Grok Bot’s persistent teammates. Focx Bot is an independent concept.` (links to `https://x.ai/news/designing-grok-bot`)

### Reset
- Title: `A fresh little start?`
- Body: `This will reset your demo tasks, conversations, teammates, and preferences.`
- Button: `Reset the demo`

---

## Toasts

| Trigger | Text |
|---|---|
| Approve | `{bot} got your okay. On to the next little win.` |
| Task marked done | `One more little win. Nice work.` |
| Task status changed | `Task updated.` |
| New task added | `{bot} has a new task in the queue.` |
| New bot added | `{bot} found a home in the den.` |
| New routine added | `A new rhythm, saved in your demo.` |
| Routine toggled | `{routine}: enabled in demo.` / `{routine}: paused.` |
| Connection toggled | `{tool} connected in demo.` / `{tool} disconnected in demo.` |
| Skill saved | `{bot} learned “{skill}” in this demo.` |
| Feedback sent | `Your feedback is with the team.` |
| Draft downloaded | `Draft downloaded.` |
| Brief attached | `Sample Connect team brief attached.` / `Brief removed.` |
| Activity paused | `A little breather. Demo activity paused.` / `Back in the groove.` |
| Bot slept / woken | `{bot} is taking a breather.` / `{bot} is back in the den.` |
| Message sent while bot is replying | `{bot} is finishing a thought. One moment.` |

**Composer label when a brief is attached:** `Brief attached`
**Bot status when slept / woken:** `Taking a little break` / `Ready for the next task`
**Bot status after approval:** `Moving to the next step`
**Bot status after feedback:** `Taking your feedback on board`

---

## Accessible names (not visible)

`Focx Bot home` · `Add a bot` · `Toggle navigation` · `Workspace` · `Your bot team` · `Team view`
`Search workspace` · `Send message` · `Attach a demo brief` · `Close dialog` · `Animate bot avatars`
`Live demo activity` · `Simulated activity` · `Illustrative team activity through the day`
`{bot} fox` (avatar) · `{bot} avatar` (avatar picker) · `Enable {routine}` · `Status for {task}`
`Pause demo activity` / `Resume demo activity`

## Voice notes

Consistent patterns worth preserving as rules:
- Headings are sentence-case statements ending in a full stop (`A second pair of eyes.`), not labels.
- Eyebrows are uppercase and typed as literal uppercase strings, not CSS-transformed.
- "Little" appears 20+ times and is the load-bearing word of the voice.
- Every destructive or external-sounding action is hedged with `demo` / `in this demo` / `simulated`.
- The user is addressed by name (`Ryan`) in chat, never in chrome.
