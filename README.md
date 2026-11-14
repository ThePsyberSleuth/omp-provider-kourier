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
- Thinking effort: `off` (`reasoning_effort: none`), then `minimal`→`low`, `low`, `medium`→`high`, `high` (default), `xhigh`→`high`, `max`. Verified against the live endpoint: `medium` as a literal returns HTTP 400, and DeepSeek's own mapping table sends `xhigh` to `high` — measured reasoning tokens are low ≈95, high ≈113, xhigh ≈102, max ≈204, so `max` is the only step above `high`. Thinking streams in `reasoning`, not `reasoning_content`; the model's `reasoning_content` must be replayed when tools are present.
- Wire quirks carried in `KOURIER_COMPAT`: effort mapping, `none` as the off switch, and thinking read from `reasoning` rather than `reasoning_content`.
- Login: email-based service authorization (`/agent/identity` and token polling), PKCE loopback browser authorization, and validated API-key entry.

The extension owns the model metadata when installed: it registers `kourier` with `KOURIER_COMPAT` and the model card above. Pointing a `models.yml` entry at provider id `kourier` (API type `openai-completions`, model id `deepseek-v4.1-flash`) is the alternative for installs without the extension; a `models.yml` entry for the same provider/id does not add a second model, so put capability or compat corrections in one place only.

## Development

```sh
npm install
npm test
npm run build
```

`npm run install-extension` installs the local extension symlink. `npm run test` runs unit and mock-server integration coverage. CLI commands: `omp-provider-kourier install`, `login`, `models`, and `test`.

## Releasing

`omp plugin upgrade` compares the catalog's `version`, so a release means bumping `version` in **both** `package.json` and `.omp-plugin/marketplace.json` (and committing a tag if you want one). Pushing code without a version bump leaves every existing install on the cached copy — `omp plugin upgrade` reports `1.0.0` and reinstalls nothing newer. After pushing:

```sh
omp plugin marketplace update kourier-providers
omp plugin upgrade omp-provider-kourier@kourier-providers
```

## Upstream contribution

`upstream/` contains the proposed first-party auth policy, provider-model descriptor, and integration notes for contributing this provider to Oh My Pi.
