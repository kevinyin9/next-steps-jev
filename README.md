# next-steps-jev

A Claude Code plugin based on [next-steps](https://github.com/anthropics/claude-plugins-community) by Thariq Shihipar. After each answer, your session's model suggests up to three next prompts. TypeSafe's [Jev](https://docs.typesafe.ai) then scores each one by how much it would help your current goal, and the best one is listed first.

```
next:
  1: run the limit_up_price unit tests  84 ★ 建議
  2: commit the current changes  40
  3: reindent the whole project  14
  0: dismiss
```

Press `1`, `2` or `3` from an empty prompt box to put that prompt in the box as a draft, then edit it and press Enter yourself. `0` dismisses. Tab takes the top suggestion. The plugin never submits a prompt on its own.

The on-screen status text is in Traditional Chinese (`★ 建議` means "recommended").

## What leaves your computer

**Your conversation text is sent to TypeSafe, a third party.** After each answer in a terminal session, the plugin sends these to `api.typesafe.ai`:

- your latest message (up to 2,000 characters)
- the model's latest answer (up to 6,000 characters)
- the suggested prompts

Long text is cut to its start and end. Anything in that text goes along with it, including code, data or secrets you pasted. Do not install this plugin if that is not acceptable for your work.

Nothing is sent from `claude -p` runs, the desktop app, VS Code, or for subagent reports. There is no switch to turn sending off for a single session.

## Setup

1. Get a TypeSafe API key.
2. If you have the original `next-steps` installed, disable it, or both will run and compete for the same number keys. The plugin shows a warning above its suggestions while the original is on.

   ```
   claude plugin disable next-steps@claude-community --scope user
   ```

3. Install the plugin at the prompt of a terminal session:

   ```
   /plugin install next-steps-jev --marketplace kevinyin9/next-steps-jev
   ```

   Answer `y` to add the marketplace, then choose a scope. From a shell:

   ```
   claude plugin install next-steps-jev --marketplace kevinyin9/next-steps-jev
   ```

4. Provide the key in one of two ways. Do not paste it into a Claude conversation.

   - **At install:** enter it on the options screen. It is saved in Claude Code's secure storage and takes priority.
   - **As an environment variable:** set `TYPESAFE_API_KEY`, then close the terminal fully and start Claude Code again. In Windows PowerShell:

     ```powershell
     $s = Read-Host 'TypeSafe key' -AsSecureString
     [Environment]::SetEnvironmentVariable('TYPESAFE_API_KEY', [Net.NetworkCredential]::new('', $s).Password, 'User')
     ```

     On macOS or Linux, add `export TYPESAFE_API_KEY=...` to your shell's startup file, such as `~/.zshrc`.

## Costs

Each answer can add two charges:

- **One extra request to your session's model**, which writes the suggestions. It reuses the prompt cache when it can. If the cache has expired or you just changed model, the whole conversation is billed again.
- **One Jev request**, billed by TypeSafe on input tokens. Check TypeSafe for current prices.

## How scoring works

Each suggestion gets a separate score from 0 to 100, based on five levels from "wastes effort or does harm" to "the goal cannot move forward without this". Scores are compared in code, so the plugin can tell you when no suggestion is worth doing now: below 50, nothing is marked as recommended. That threshold is a starting value, so adjust `RECOMMEND_FROM` in `hooks/register.tsx` if it does not suit you.

Jev gives numbers without reasons, and it sees only the text listed above, so it does not know your longer-term goals. Treat a score as a second opinion.

If Jev has no key, returns an error, or takes more than 3 seconds, the suggestions still appear in their original order, with the reason at the top.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `typesafeApiKey` | unset | Your TypeSafe key, kept in secure storage. If unset, `TYPESAFE_API_KEY` is used |
| `minAnswerChars` | `80` | Skip suggestions after answers shorter than this |
| `suggestSkills` | `true` | Tell the suggester which skills and slash commands the session has |

## Tests

```
claude plugin test .
```

## License

MIT. See [LICENSE](LICENSE). Keep the original author's notice when you redistribute this.
