# Studio Chromium

Studio can launch a separate headless Chromium for inspecting the local website. Use this instead of launching Playwright/Chromium inside the coding sandbox. It starts only when requested, may download its browser on first use, and closes when this agent call ends or is stopped. If unavailable, report the error honestly. This is an optional tool, not another pipeline stage.

Start the draft's web server yourself in the project directory. Then call:

```sh
node "$STUDIO_BROWSER_CLIENT" '{"action":"goto","url":"http://127.0.0.1:3000"}'
node "$STUDIO_BROWSER_CLIENT" '{"action":"snapshot"}'
node "$STUDIO_BROWSER_CLIENT" '{"action":"screenshot"}' .studio-tmp/desktop.png
```

Open the saved screenshot with your image-viewing tool to inspect the rendered result.

Other JSON actions:
- `{"action":"viewport","width":390,"height":844}`
- `{"action":"click","selector":"button:has-text(\"Save\")"}`
- `{"action":"fill","selector":"input[name=search]","value":"example"}`
- `{"action":"press","selector":"input[name=search]","key":"Enter"}`
- `{"action":"evaluate","expression":"document.querySelector('main').getBoundingClientRect().toJSON()"}`
- `{"action":"screenshot","fullPage":true}` (pass a second CLI argument for the image destination).

Selectors use Playwright locator syntax. Evaluate runs JavaScript in the web page, not on the host. For repeated interactions, import `browser` from the file named by STUDIO_BROWSER_CLIENT in a Node script, and call `await browser(action, optionalScreenshotPath)`.

Navigation is limited to HTTP(S) localhost, 127.0.0.1 or [::1]. No personal browser profile, uploads, downloads or arbitrary host commands are exposed. Screenshots are saved by your client inside the coding sandbox. This tool does not automatically connect existing Playwright test suites; use it for visual inspection and interactions, and report separately which project tests actually ran. Do not print the browser token or save it in project files.
