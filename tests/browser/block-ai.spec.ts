import { test, expect } from "@playwright/test";

test("AI action belongs to the selected block and accepted text survives reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Ask AI about/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const text = page.getByPlaceholder("Write…").last();
  await text.fill("User written content");
  await expect(page.getByRole("button", { name: /^Ask AI about/ })).toHaveCount(1);
  await page.getByRole("button", { name: /^Ask AI about/ }).click();
  let dialog = page.getByRole("dialog", { name: "Edit block with AI" });
  await dialog.getByLabel("What would you like to add or change?").fill("Make this clearer");
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "AI content preview" })).toContainText("AI revised specification content");
  await expect(text).toHaveValue("User written content");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(text).toHaveValue("User written content");
  await page.getByRole("button", { name: /^Ask AI about/ }).click();
  dialog = page.getByRole("dialog", { name: "Edit block with AI" });
  await dialog.getByLabel("What would you like to add or change?").fill("Make this clearer");
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await dialog.getByRole("button", { name: "Use content", exact: true }).click();
  await expect(text).toHaveValue("AI revised specification content");
  await expect(page.getByRole("status", { name: "All changes saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder("Write…").last()).toHaveValue("AI revised specification content");
  await expect(page.getByRole("button", { name: /^Ask AI about/ })).toHaveCount(0);
  await page.getByPlaceholder("Write…").first().focus();
  await expect(page.locator(".editor-node").first().getByRole("button", { name: /^Ask AI about/ })).toBeVisible();
  await page.getByPlaceholder("Write…").last().focus();
  await expect(page.locator(".editor-node").first().getByRole("button", { name: /^Ask AI about/ })).toHaveCount(0);
});

test("image blocks offer upload or AI generation with preview and saved asset", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Image", exact: true }).click();
  const choice = page.getByRole("dialog", { name: "Add image block" });
  await expect(choice.getByRole("button", { name: "Upload image", exact: true })).toBeVisible();
  await choice.getByRole("button", { name: "Generate with AI", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Generate image with AI" });
  await expect(dialog).toContainText("Describe the image you want to create");
  await expect(dialog).not.toContainText("SVG");
  await dialog.getByLabel("Describe your image").fill("A blue circle");
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog.getByRole("img", { name: "AI blue circle" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "AI blue circle" })).toHaveJSProperty("naturalWidth", 1);
  await expect(page.locator(".editor-node.node-image")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Use content", exact: true }).click();
  await expect(page.locator(".editor-node.node-image").getByRole("img", { name: "AI blue circle" })).toBeVisible();
  await expect(page.getByRole("status", { name: "All changes saved" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".editor-node.node-image").getByRole("img", { name: "AI blue circle" })).toBeVisible();
});

test("lists and tables accept generated structured content", async ({ page }) => {
  await page.goto("/");
  for (const type of ["List", "Table"]) {
    await page.getByRole("button", { name: type, exact: true }).click();
    await page.getByRole("button", { name: /^Ask AI about/ }).click();
    const dialog = page.getByRole("dialog", { name: "Edit block with AI" });
    await dialog.getByLabel("What would you like to add or change?").fill("Add an example");
    await dialog.getByRole("button", { name: "Generate", exact: true }).click();
    await dialog.getByRole("button", { name: "Use content", exact: true }).click();
  }
  await expect(page.getByLabel("List items").last()).toHaveValue("Generated first item\nGenerated second item");
  await expect(page.getByLabel("Table row 2 column 1").last()).toHaveValue("Generated row");
});

test("a block changed elsewhere cannot be overwritten by an older AI proposal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const text = page.getByPlaceholder("Write…").last();
  await text.fill("Original block content");
  await expect(page.getByRole("status", { name: "All changes saved" })).toBeVisible();
  const nodeId = (await page.locator(".editor-node").last().getAttribute("id"))!.slice(5);
  await page.getByRole("button", { name: /^Ask AI about/ }).click();
  const dialog = page.getByRole("dialog", { name: "Edit block with AI" });
  await dialog.getByLabel("What would you like to add or change?").fill("Improve this");
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Use content", exact: true })).toBeVisible();
  await page.evaluate(async id => {
    const session = await (await fetch("/api/bootstrap")).json();
    const headers = { "Content-Type": "application/json", "X-Studio-Token": session.token, "X-Studio-Project": session.projectKey };
    const state = await (await fetch("/api/state", { headers })).json();
    const document = state.project.documents.find((doc: { nodes: { id: string }[] }) => doc.nodes.some(node => node.id === id));
    document.nodes.find((node: { id: string }) => node.id === id).text = "Newer external edit";
    const response = await fetch(`/api/documents/${document.id}`, { method: "PUT", headers, body: JSON.stringify(document) });
    if (!response.ok) throw new Error(await response.text());
  }, nodeId);
  await expect(text).toHaveValue("Newer external edit");
  await dialog.getByRole("button", { name: "Use content", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("This block changed while AI was working");
  await expect(text).toHaveValue("Newer external edit");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("Claude disables image generation with an explanation, retains uploads and text AI, and switching providers restores it", async ({ page }) => {
  await page.goto("/");
  const selectProvider = async (provider: "claude" | "gemini" | "codex") => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("combobox", { name: "Service", exact: true }).click();
    await settings.getByRole("option", { name: { claude: "Claude Code CLI", gemini: "Gemini CLI", codex: "Codex CLI" }[provider], exact: true }).click();
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings).not.toBeVisible();
  };
  await selectProvider("claude");
  await page.getByRole("button", { name: "Image", exact: true }).click();
  let choice = page.getByRole("dialog", { name: "Add image block" });
  await expect(choice.getByRole("button", { name: "Generate with AI", exact: true })).toBeDisabled();
  await expect(choice).toContainText("Image generation is unavailable with Claude");
  await expect(choice).toContainText("Choose Codex or Gemini in Settings");
  const chooser = page.waitForEvent("filechooser");
  await choice.getByRole("button", { name: "Upload image", exact: true }).click();
  await (await chooser).setFiles({ name: "claude-upload.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>') });
  const image = page.locator(".editor-node.node-image").last();
  await expect(image.getByRole("img", { name: "claude-upload.svg" })).toBeVisible();
  await image.getByRole("img").click();
  await image.getByRole("button", { name: /^Ask AI about/ }).click();
  const dialog = page.getByRole("dialog", { name: "Generate image with AI" });
  await expect(dialog).toContainText("Image generation is unavailable with Claude");
  await expect(dialog.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: /^Ask AI about/ }).click();
  const textDialog = page.getByRole("dialog", { name: "Edit block with AI" });
  await textDialog.getByLabel("What would you like to add or change?").fill("Write requirements");
  await expect(textDialog.getByRole("button", { name: "Generate", exact: true })).toBeEnabled();
  await textDialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(textDialog.getByRole("button", { name: "Use content", exact: true })).toBeVisible();
  await textDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const provider of ["gemini", "codex"] as const) {
    await selectProvider(provider);
    await page.getByRole("button", { name: "Image", exact: true }).click();
    choice = page.getByRole("dialog", { name: "Add image block" });
    await expect(choice.getByRole("button", { name: "Generate with AI", exact: true })).toBeEnabled();
    await expect(choice).not.toContainText("unavailable with Claude");
    await choice.getByRole("button", { name: "Close image options", exact: true }).click();
  }
});
