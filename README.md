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
- DeepSeek V4.1 Flash: 262,144 context, 16,384 max output, text/image input, reasoning with low/medium/high effort (medium default), flat-rate zero per-token cost metadata.
- Login: email-based service authorization (`/agent/identity` and token polling), PKCE loopback browser authorization, and validated API-key entry.

The provider can also be configured through omp's `models.yml` provider/model configuration using provider id `kourier`, API type `openai-completions`, and model id `deepseek-v4.1-flash`.

## Development

```sh
npm install
npm test
npm run build
```

`npm run install-extension` installs the local extension symlink. `npm run test` runs unit and mock-server integration coverage. CLI commands: `omp-provider-kourier install`, `login`, `models`, and `test`.

## Upstream contribution

`upstream/` contains the proposed first-party auth policy, provider-model descriptor, and integration notes for contributing this provider to Oh My Pi.
