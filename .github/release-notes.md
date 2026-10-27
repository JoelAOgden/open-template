Download the installer matching your system:

- **macos-arm64.dmg** — Apple Silicon Macs.
- **macos-x64.dmg** — Intel Macs.
- **windows-x64.exe** or **windows-x64.msi** — 64-bit Windows.

These preview builds are not developer-signed or notarized (macOS uses ad-hoc signing). Your operating system may warn or block installation. Claude's required sandbox does not currently support native Windows execution. Provider sign-in is required; generated projects may need additional development tools.

**macOS installation:** open the DMG, drag **open-template** into **Applications**, then launch it. If macOS says Apple could not verify open-template, and you trust the release you downloaded, go to **System Settings → Privacy & Security → Open Anyway** after trying to open the app, then confirm. See [Apple’s instructions](https://support.apple.com/en-gb/102445).

SHA256SUMS.txt contains installer checksums. Corresponding source is available in the source archives for this release tag. open-template is GPLv3; bundled third-party tools retain their own licenses and terms.
