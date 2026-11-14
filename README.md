# omp-provider-kourier

A native provider extension for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi) using [Kourier](https://kourier.sh)'s OpenAI-compatible DeepSeek V4.1 Flash API.

## Install

As an omp marketplace plugin (recommended):

```sh
omp plugin marketplace add ThePsyberSleuth/omp-provider-kourier
omp plugin install omp-provider-kourier@kourier-providers
```

In a session the same is `/marketplace add ThePsyberSleuth/omp-provider-kourier` then `/marketplace install omp-provider-kourier@kourier-providers`, then restart the omp session — `/reload-plugins` only refreshes skills, commands, agents, and MCP servers, while a newly installed extension module loads at startup. The plugin declares `package.json` `omp.extensions`, so installation symlinks it into `~/.omp/plugins/node_modules` and omp loads the provider from there — do not also link it into `~/.omp/agent/extensions/`, or the provider is registered twice.

From npm instead:

```sh
npm install -g omp-provider-kourier
omp-provider-kourier install
```

The installer links the extension into `~/.omp/agent/extensions/`; restart `omp` to load it. Or place `src/index.ts` there manually. From omp, run `/login kourier`, then select agent email sign-in, browser/PKCE sign-in, or paste an API key. Select `/model kourier/deepseek-v4.1-flash` to use the default model. `omp login kourier` is the native omp login command; the standalone package CLI also has a `login` command for validating a pasted key.

Alternatively set `KOURIER_API_KEY` in the environment. Keys are sent only to Kourier's API over HTTPS.

## Provider details

- API: `openai-completions`
- Base URL: `https://api.kourier.sh/v1`
- Model catalog: live `GET /models`; when discovery cannot run, the extension retains its static DeepSeek V4.1 Flash entry.
- DeepSeek V4.1 Flash: 262,144 context, flat-rate zero per-token cost metadata.
- Output budget: **no 16,384 cap.** Kourier's docs and dashboard say 16,384 max output, but the endpoint only enforces `prompt_tokens + max_tokens <= 262144`. Measured: `max_tokens: 16385` returns `finish_reason: "length"` at exactly 16385 tokens, and a 40,000 budget completed at 20,831 tokens. The model card therefore advertises 65,536 — DeepSeek's documented thinking-mode default — leaving ~196K of prompt room. `GET /v1/models` advertises no output limit at all, so a declared `max_output_tokens` is honored when present and 65,536 is used otherwise.
- Reasoning shares the output budget: at `reasoning_effort: high` a forced 3,000-token cap finished `length` with 937 of those tokens spent on reasoning. A `max` run therefore yields less visible answer per token, not more room. omp sends this limit as `max_completion_tokens` (not `max_tokens`), verified on the wire.
- Thinking effort: `off` (`reasoning_effort: none`), then `minimal`→`low`, `low`, `medium`→`high`, `high` (default), `xhigh`→`high`, `max`. Verified against the live endpoint: `medium` as a literal returns HTTP 400, and DeepSeek's own mapping table sends `xhigh` to `high` — measured reasoning tokens are low ≈95, high ≈113, xhigh ≈102, max ≈204, so `max` is the only step above `high`. Thinking streams in `reasoning`, not `reasoning_content`; the model's `reasoning_content` must be replayed when tools are present.
- Wire quirks carried in `KOURIER_COMPAT`: effort mapping, `none` as the off switch, and thinking read from `reasoning` rather than `reasoning_content`.
- Tool calls: verified end to end at both `high` and `max` — the model returns a `tool_calls` entry with parseable arguments, and a second completion carrying the matching `tool_call_id` and the tool result produces the correct answer. Forced (`tool_choice` naming a function) and `required` are honored; `none` disables tools; no 400 and no retry on any of them. On the tool-call turn DeepSeek emits no reasoning at all, so omp replays `reasoning: ""`; the endpoint accepts that or an omitted field, so the replay quirk is tolerated rather than load-bearing.
- Login: email-based service authorization (`/agent/identity` and token polling), PKCE loopback browser authorization, and validated API-key entry.

### The Responses endpoint (`POST /v1/responses`)

Kourier also serves OpenAI's Responses format. It works, but this plugin deliberately stays on `openai-completions` because the two surfaces take **different content-part schemas** and the Responses one is broken for text:

| Aspect | Chat Completions | Responses |
|---|---|---|
| Text parts | `{"type":"text"}` accepted | `{"type":"input_text"}` **rejected** — `supports text and image content only; got 'input_text'`; `{"type":"text"}` also rejected |
| Plain string content | accepted | accepted — the only way to send text |
| Image parts | `{"type":"image_url"}` accepted | `{"type":"input_image"}` **accepted** (verified: solid blue → "Blue", green → "Green") |
| Image + text in one turn | accepted | **not possible**: an `input_image` part cannot be combined with any text part; put the instruction in a separate plain-string message |
| `medium` effort | 400 | 400 (same `KOURIER_COMPAT` mapping needed) |
| Tool call → result | `function_call_output` not needed | works via `{"type":"function_call_output","call_id":…,"output":…}` |
| `previous_response_id` | n/a | **404** — server is stateless, replay full `output` instead |
| Video input | not accepted — part silently dropped | not accepted — 400 |

### Video is not supported by Kourier's schemas

DeepSeek-V4.1-Flash-1017 is a multimodal model, and third-party mirrors advertise video alongside vision, but neither Kourier surface accepts video. Measured with a real 6 s H.264 clip (red → green → blue, verified by extracting frames at t=1/3/5 s), instruction sent as a separate message so a drop can only be the media:

| Request | Status | Prompt tokens (text-only baseline: 54) | Outcome |
|---|---|---|---|
| `{"type":"video_url","video_url":{"url":"data:video/mp4;base64,…"}}` | 200 | 55 | part dropped — reply: "no clip was attached" |
| `{"type":"video_url","video_url":"data:video/mp4;base64,…"}` | 200 | 55 | dropped |
| `{"type":"video","video":…}` / `{"type":"input_video",…}` / `{"type":"file",…}` | 200 | 55 | dropped |
| `image_url` carrying MP4 data | 400 | — | "cannot identify image file" |
| `/responses` `input_video` (part or item) | 400 | — | validation: expected `input_text` |
| **Control:** the same three frames as `image_url` PNGs | 200 | 640 | **correct — "Red / Green / Blue"** |

The control is the point: stills from that exact clip are read correctly and in temporal order, so the model and the vision path work — only the video *part* is unsupported. A video part returns 200 with the media discarded, so status codes cannot be used to detect it; compare `prompt_tokens` against a text-only baseline. Extracting frames is the supported way to get temporal content in.

Scope: this tests Kourier's `chat/completions` and `/responses` schemas, which is all the plugin uses. It is not a statement about the model's or DeepSeek's own API's capability; DeepSeek's vision guide documents JPEG/PNG/GIF/WebP only.

Images on the Responses surface are therefore *not* impossible — `input_image` works, including in multi-turn history — but text must be a plain string and an image message cannot also carry an instruction. omp's Responses provider emits `input_text` parts, so pointing `api: openai-responses` at Kourier fails immediately with a 400; the plugin follows omp's own schema rather than a lossy translation layer. `previous_response_id` also 404s, so any client must replay full history.

Reasoning streams as `response.reasoning_text.delta` with `output_tokens_details.reasoning_tokens`, and `max_output_tokens` accepts up to 262,143 (the same `prompt + output ≤ 262144` rule, measured on both surfaces).

The extension owns the model metadata when installed: it registers `kourier` with `KOURIER_COMPAT` and the model card above. Pointing a `models.yml` entry at provider id `kourier` (API type `openai-completions`, model id `deepseek-v4.1-flash`) is the alternative for installs without the extension; a `models.yml` entry for the same provider/id does not add a second model, so put capability or compat corrections in one place only.

## Development

```sh
npm install
npm test
npm run laws
npm run build
```

`npm run laws` proves the stateful rules with [gdp-wired](https://github.com/monotykamary/gdp-wired). Every state machine and decision in `src/` has a model and a replay against the shipped code:

| Area | Model | Replay |
|---|---|---|
| Poll backoff (`nextPollDelay`) | `laws/proven.ts` + `gdp: law` in source | checked directly from `src/auth/poll-delay.ts` |
| Auth poll loop deadline | `laws/protocol.ts` | `tests/service-auth-deadline.test.ts` |
| Catalog output budget | `laws/protocol.ts` | `tests/catalog-max-tokens.test.ts` |
| API-key sanitization | `laws/proven.ts` | `tests/verify-key-sanitize.test.ts` |
| PKCE callback settlement | `laws/pkce.ts` | `tests/pkce-state.test.ts` |
| Credential refresh | `laws/refresh.ts` | `tests/refresh.test.ts` |
| Install guards | `gdp: law` in `src/install-guard.ts` | `tests/install-guard.test.ts` (all 16 inputs) |

The auth-poll and catalog loops were first *refuted* — a witness run showed a poll sent at expiry and a budget exceeding the context window; both are fixed and now prove. Two laws state what the shipped code does rather than what one might assume: `nextPollDelay`'s `+5000` applies only on `slow_down`, and a blank key makes no request. String/regex source (`verifyApiKey`'s trim and CR/LF check) is outside the extractor's boundary, so it is proven as a model and compared exhaustively against the real function, not extracted.

`npm run install-extension` installs the local extension symlink. `npm run test` runs unit and mock-server integration coverage, plus a live tool-call round-trip suite (`tests/tool-roundtrip.test.ts`) that calls the real endpoint using `KOURIER_API_KEY` — it skips cleanly when no key is present, so it is safe in CI. CLI commands: `omp-provider-kourier install`, `login`, `models`, and `test`.

## Releasing

`omp plugin upgrade` compares the catalog's `version`, so a release means bumping `version` in **both** `package.json` and `.omp-plugin/marketplace.json` (and committing a tag if you want one). Pushing code without a version bump leaves every existing install on the cached copy — `omp plugin upgrade` reports `1.0.0` and reinstalls nothing newer. After pushing:

```sh
omp plugin marketplace update kourier-providers
omp plugin upgrade omp-provider-kourier@kourier-providers
```

## Upstream contribution

`upstream/` contains the proposed first-party auth policy, provider-model descriptor, and integration notes for contributing this provider to Oh My Pi.
