# omp-provider-kourier

A native provider extension for [omp (Oh My Pi)](https://github.com/can1357/oh-my-pi) using [Kourier](https://kourier.sh)'s OpenAI-compatible DeepSeek V4.1 Flash API.

## Install

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
- DeepSeek V4.1 Flash: 262,144 context, 16,384 max output, text/image input, reasoning at low/high/xhigh/max effort (high default; `medium` and `minimal` are mapped to `high`/`low` because the endpoint rejects the literal strings), flat-rate zero per-token cost metadata.
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

## Upstream contribution

`upstream/` contains the proposed first-party auth policy, provider-model descriptor, and integration notes for contributing this provider to Oh My Pi.
