# next-steps-jev

**Suggested next steps for Claude Code, scored by how much each one helps your goal.**

After each answer, your session's model suggests up to three next prompts. Those suggestions are its guess at what you are likely to ask, which is not always what is most worth doing. So a second model, TypeSafe's [Jev](https://docs.typesafe.ai), scores each one against your current goal and the best one is listed first.

```
next:
  1: run the limit_up_price unit tests  84 ★ 建議
  2: commit the current changes  40
  3: reindent the whole project  14
  一起做   4: 1+2   5: 2+3   6: 1+3   7: 1+2+3
  0: dismiss
```

The scores above come from a real Jev request on a made-up conversation about fixing a bug. `★ 建議` means "recommended" and `一起做` means "do together".

Press `1`, `2` or `3` from an empty prompt box to put that prompt in the box as a draft, then edit it and press Enter yourself. To do several at once, press `4` to `7`: the chosen prompts go into one draft as a numbered list, in the order shown. `0` dismisses. Tab takes the top suggestion. The plugin never submits a prompt on its own.

## Requirements

- Claude Code in a terminal. Suggestions are not drawn in the desktop app or VS Code. The Claude mobile app (Remote Control) does not draw them either: there, type `/jev-next` to print the current suggestions as text, then copy the one you want. Tested on version 2.1.317. The plugin API it uses is in early access and may change between releases.
- A TypeSafe API key.
- You accept that conversation text is sent to TypeSafe, as described next.

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

## Is Jev worth it?

The plugin records what you do with each scored offer: whether you pressed Jev's first place, another one, several at once, `0`, or sent something else. Sending a suggestion unchanged, as Tab does, counts as choosing it. Run `/jev-stats` to see how often you chose the first place, next to how often you would by chance. If you rarely choose it, Jev is adding cost without helping you.

Only scores and positions are kept, never prompt or conversation text. The record stays in Claude Code's storage for this plugin on your computer, holds the latest 1,000 offers, and is never sent anywhere. Offers that Jev did not score are not recorded. `/jev-stats reset` clears it.

## On-screen messages

Messages appear above the suggestions, in Traditional Chinese. If Jev cannot score, the suggestions still appear in their original order.

| Message | Meaning |
| --- | --- |
| `Jev：這幾個都不太值得現在做` | Scored, but none reached 50, so nothing is recommended |
| `Jev 未評分：找不到金鑰，請設定 TYPESAFE_API_KEY` | Not scored: no key found, and nothing was sent |
| `Jev 未評分：逾時` | Not scored: Jev took more than 3 seconds |
| `Jev 未評分：HTTP 401` (or another code) | Not scored: Jev returned this error. 401 usually means a bad key |
| `Jev 未評分：回應格式不對` | Not scored: Jev's reply could not be read |
| `Jev 未評分：連線失敗` | Not scored: the request failed |
| `原版 next-steps 也還開著…` (yellow) | The original plugin is still on. The message gives the command to turn it off |

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `typesafeApiKey` | unset | Your TypeSafe key, kept in secure storage. If unset, `TYPESAFE_API_KEY` is used |
| `minAnswerChars` | `80` | Skip suggestions after answers shorter than this |
| `suggestSkills` | `true` | Tell the suggester which skills and slash commands the session has |

## Update or remove

```
claude plugin update next-steps-jev@next-steps-jev
claude plugin uninstall next-steps-jev@next-steps-jev
```

After an update, restart Claude Code.

## Tests

```
claude plugin test .
```

## 繁體中文簡介

每次回答結束後，Claude 會建議最多 3 個下一步，再由 TypeSafe 的 Jev 依「對完成目前目標的幫助」替每個選項打 0 到 100 分，最高分排第一。按 1 到 3 選一個；按 4 到 7 可一次選兩三個（1+2、2+3、1+3、1+2+3），會合成一份編號清單。按數字鍵只會把內容放進輸入框，不會自動送出。

用 Claude 手機 app 遙控終端機（Remote Control）時，手機看不到輸入框上方的選項。這時在手機輸入 `/jev-next`，會印出目前的建議和分數，長按複製想用的那句再貼上送出。照原樣送出也會記進 `/jev-stats`。

**注意：** 你的最後一句話、模型的最後回答和建議選項都會送到 TypeSafe，也會多出模型和 Jev 的費用。輸入 `/jev-stats` 可以看你有多常選 Jev 的第一名，這份紀錄只有分數和位置、只存在你的電腦。安裝前請先看上面的 [What leaves your computer](#what-leaves-your-computer) 和 [Costs](#costs)。

## Credits

Based on [next-steps](https://github.com/anthropics/claude-plugins-community) by Thariq Shihipar.

## License

MIT. See [LICENSE](LICENSE). Keep the original author's notice when you redistribute this.
