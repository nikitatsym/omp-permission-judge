# omp-permission-judge

An authorizer link for [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system)
on [oh-my-pi](https://github.com/can1357/oh-my-pi) (omp). When a permission rule
lands on `ask`, the link puts the ask to omp's `judge` model role and allows,
denies, or passes it on, depending on the probabilities the judge returns.

It works with any tool the permission system gates (bash, file tools, MCP,
skills, extension tools) and with any model omp can put in the `judge` role.
It needs omp's `judgment` module, so it does not run on Pi.

## Requirements

- omp with `@gotgenes/pi-permission-system` 42 installed (on omp, from the
  [omp fork](https://github.com/nikitatsym/pi-permission-system)).
- A model in the `judge` role. `omp models --kind judge` lists the decision
  models omp can reach; set one in `~/.omp/agent/config.yml`, for example:

  ```yaml
  modelRoles:
    judge: openrouter/~typesafe/jev-latest
  ```

  Without a configured role omp picks a judge-capable model itself. The role
  also serves other omp features that ask the judge.

Decision models (TypeSafe Jev, Cloudflare Clef, OpenRouter and OpenAI
decision models) return calibrated probabilities. A chat model in the role
answers with one word, which omp turns into probability 1 for that option:
the thresholds then filter nothing and the model's word decides.

## Install and enable

```bash
omp plugin install "git+https://github.com/nikitatsym/omp-permission-judge.git"
```

Name the link in `~/.omp/agent/extensions/pi-permission-system/config.json`;
installing alone enables nothing:

```json
{
  "yoloMode": false,
  "authorizerChain": ["judge"]
}
```

`yoloMode: true` approves asks before any link runs.

## Decision

The judge answers one choice question, allow / deny / ask, with probabilities
that sum to 1:

1. P(deny) at or above `denyThreshold`: with `onDeny: "deny"` the call is
   denied and the agent gets the reason; with `onDeny: "confirm"` the link
   shows a warning and passes the ask on.
2. Otherwise, P(allow) at or above `allowThreshold`: the call is allowed.
3. Otherwise the ask passes on.

"Passes on" means the next link in `authorizerChain`, then the user's prompt
(or, without a UI, a denial). With other links after this one, they can still
allow what the judge flagged; only a chain where this link is last or alone
guarantees that a flagged call reaches the user. pi-permission-system turns
any link's allow on a `path` or `external_directory` ask into a pass.

## Configuration

`~/.omp/agent/extensions/omp-permission-judge/config.json`, read at session
start. A missing file means the defaults; an invalid one fails the session
start with the file and key in the error, and the link stays unregistered.

| Key | Default | Meaning |
|---|---|---|
| `allowThreshold` | 0.9 | P(allow) needed to allow. |
| `denyThreshold` | 0.9 | P(deny) needed to act on a deny; checked first. |
| `onDeny` | `"confirm"` | `"confirm"` passes a judged deny on, `"deny"` denies it. |
| `timeoutMs` | 10000 | Deadline for the whole judgment; on expiry the ask passes on. |
| `contextMessages` | 6 | Recent user and assistant messages the judge sees. |
| `maxTextChars` | 4000 | Cap on every string sent to the judge. |
| `instructions` | see `src/config.ts` | The question put to the judge. |
| `criteria` | see `src/config.ts` | Text for `allow`, `deny` and `ask`; each can be set alone. |

## What the judge sees

The state sent to the judge's provider holds the permission system's full
structured description of the ask (tool, surface, command or path, matched
rule, evidence), the working directory, and the text of the last
`contextMessages` user and assistant messages. Tool results and thinking are
not sent.

## Records

Every judgment writes a `permission_judge.decision` entry to the permission
review log (`logs/pi-permission-system-permission-review.jsonl` under the
permission system's config directory) with the model, probabilities, outcome,
duration and cost. Judge cost is added to the session's usage statistics.

When the judge fails (no judge model, no key, provider error, timeout) the
ask passes on, the entry records the error, and the first failure in a
session shows a warning.

## Development

`python3 dev.py check` (bun and uv on `PATH`) installs the dependencies and
runs the type check, tackbox lint and the tests; CI and the pre-commit hook
run the same command. `python3 dev.py hook` enables the hook in a clone.

## License

[MIT](LICENSE)
