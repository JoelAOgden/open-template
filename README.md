# open-template

A local workspace for building software from written requirements, with an AI agent (**Codex CLI, Gemini CLI, or Claude Code**)

Create or open a project, describe its features, design, architecture, and testing requirements, then run the pipeline to trigger ai agents to comply with the specification.

## Download and install

Open this repository's **Releases** page on GitHub, choose a release, and expand **Assets** to download an installer (rather than the source-code archives).

- **macOS:** download `macos-arm64.dmg` for Apple Silicon or `macos-x64.dmg` for Intel. Open the DMG, drag **open-template** into **Applications**, then launch it.
- **Windows — untested:** download `windows-x64.exe` or `windows-x64.msi`, run the installer, and launch **open-template** from the Start menu. Windows builds are provided for testing; installation and runtime behavior have not been verified on a real Windows machine. Claude's required sandbox currently prevents native Windows execution.

Installers include Node and the provider CLI tools. Choose a provider in **Settings** and sign in. These preview releases are not developer-signed or notarized, so your operating system may warn or block installation. If no release is listed yet, use the development setup below.

## Development setup

Requires Node.js 22.12+, npm, and Git. Desktop development also requires Rust and platform build tools: Xcode command-line tools on macOS; Visual Studio C++ build tools and WebView2 on Windows.

```sh
npm ci
npm run desktop:dev
```

Setup downloads the provider CLI tools. Choose a provider in Settings and sign in with its CLI. Provider access and usage charges depend on your account. Generated projects may need additional development tools.

For browser development, run `npm run dev` and open http://127.0.0.1:4310.

## Build and check

```sh
npm run typecheck
npm run check:architecture
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Build an installer with `npm run desktop:build` on the target OS and architecture. Output: `src-tauri/target/release/bundle/`. Signing and bundled-provider redistribution checks remain release tasks.

## GitHub releases

Target release PRs at `release`. Include a new application version in each release PR:

```sh
npm run release:version -- 0.1.0
# Commit the version changes, then open and merge a PR into release.
```

Merging into `release` creates `releases/<version>` at that exact commit. The same workflow explicitly calls the installer build, tests all targets, and publishes downloads with checksums and a `v<version>` tag after every build passes. Apple Silicon/Intel macOS and Windows x64 are built separately.

Snapshot branches have no deployment trigger: creating or pushing `releases/*` or tags does not publish anything. Existing version branches are never overwritten by the workflow. Retry a failed run in Actions; use a new version for subsequent merges. Versions such as `0.2.0-beta.1` create prereleases. GitHub's automatic token is used; no personal access token is needed.

Initial downloads are unsigned (ad-hoc signed on macOS), not notarized, and may trigger OS security warnings. Signing and provider redistribution checks remain release tasks. This publishes downloads; it does not auto-update installed apps.

## Local data

Projects stay in your chosen folder; `.project-studio/` holds their definitions and history. No default project is created.

Desktop info: `~/Library/Application Support/open-template` on macOS or `%APPDATA%\open-template` on Windows.

## License

Copyright (c) 2026 open-template contributors. Licensed under [GPLv3](LICENSE), without warranty. Third-party dependencies and provider tools retain their own licenses and terms.
