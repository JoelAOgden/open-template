import { test, expect, type Locator } from "@playwright/test";

async function choose(control:Locator,value:string) {
 await control.click();
 const id=await control.getAttribute('aria-controls');
 await control.page().locator(`[id="${id}"] [role="option"][data-value="${value}"]`).click();
}

test("service selection persists and clears incompatible model and reasoning choices", async ({page}) => {
  await page.goto("/");
  await page.getByRole("button", {name:"Settings",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Settings",exact:true});
  await expect(dialog.getByRole("combobox",{name:"Service",exact:true})).toHaveAttribute("value","codex");
  await choose(dialog.getByRole("combobox",{name:"Model",exact:true}), "custom");
  await dialog.getByLabel("Model ID",{exact:true}).fill("codex-only-model");
  await choose(dialog.getByRole("combobox",{name:"Reasoning",exact:true}), "high");
  await choose(dialog.getByRole("combobox",{name:"Service",exact:true}), "gemini");
  await expect(dialog.getByRole("combobox",{name:"Model",exact:true})).toHaveAttribute("value","");
  await expect(dialog.getByRole("combobox",{name:"Reasoning",exact:true})).toHaveCount(0);
  await dialog.getByRole("button",{name:"Save",exact:true}).click();
  await page.reload();
  await page.getByRole("button", {name:"Settings",exact:true}).click();
  await expect(dialog.getByRole("combobox",{name:"Service",exact:true})).toHaveAttribute("value","gemini");
  await choose(dialog.getByRole("combobox",{name:"Service",exact:true}), "claude");
  await choose(dialog.getByRole("combobox",{name:"Model",exact:true}), "custom");
  await dialog.getByLabel("Model ID",{exact:true}).fill("sonnet");
  await dialog.getByRole("button",{name:"Save",exact:true}).click();
  await page.reload();
  await page.getByRole("button", {name:"Settings",exact:true}).click();
  await expect(dialog.getByRole("combobox",{name:"Service",exact:true})).toHaveAttribute("value","claude");
  await expect(dialog.getByRole("combobox",{name:"Model",exact:true})).toHaveAttribute("value","sonnet");
  await choose(dialog.getByRole("combobox",{name:"Service",exact:true}), "codex");
  await expect(dialog.getByRole("combobox",{name:"Reasoning",exact:true})).toBeVisible();
  await dialog.getByRole("button",{name:"Save",exact:true}).click();
});

test("included services offer sign-in without installation controls",async({page})=>{
 const installed=true;let signedIn=false;
 const actions:unknown[]=[];
 await page.route('**/api/services/status?*',route=>{
  const provider=new URL(route.request().url()).searchParams.get('provider');
  return route.fulfill({json:{provider,installed,auth:signedIn?'signed-in':'signed-out',message:!installed?'CLI is not installed.':signedIn?'Signed in.':'Not signed in.'}});
 });
 await page.route('**/api/services/setup',async route=>{
  actions.push(route.request().postDataJSON());
  await route.fulfill({json:{message:'Terminal opened. Complete sign-in there, then refresh status.'}});
 });
 await page.goto('/');await expect(page).toHaveTitle('open-template');
 await expect(page.getByText('open-template',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
 await choose(dialog.getByRole('combobox',{name:'Service',exact:true}), "gemini");
 await expect(dialog.getByRole('button',{name:'Install and sign in',exact:true})).toHaveCount(0);
 await expect(dialog.getByText('Manual setup',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
 expect(actions).toEqual([{provider:'gemini',action:'login'}]);
 await expect(dialog.getByText(/Terminal opened/)).toBeVisible();
 await dialog.getByRole('button',{name:'Refresh status',exact:true}).click();
 await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
 expect(actions[1]).toEqual({provider:'gemini',action:'login'});
 signedIn=true;
 await choose(dialog.getByRole('combobox',{name:'Service',exact:true}), "claude");
 await expect(dialog.getByRole('button',{name:'Sign in with another account'})).toBeVisible();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
});

test('custom dropdown supports keyboard selection, cancellation and outside dismissal',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
 const service=dialog.getByRole('combobox',{name:'Service',exact:true});
 await expect(page.locator('select')).toHaveCount(0);
 const original=await service.getAttribute('value');
 await service.focus();await service.press('ArrowDown');
 await expect(service).toHaveAttribute('aria-expanded','true');
 await service.press('End');await service.press('Escape');
 await expect(dialog).toBeVisible();await expect(service).toBeFocused();
 await expect(service).toHaveAttribute('value',original!);
 await service.press('Enter');await service.press('g');await service.press('Enter');
 await expect(service).toHaveAttribute('value','gemini');
 await service.click();
 await dialog.getByRole('heading',{name:'Settings',exact:true}).click();
 await expect(service).toHaveAttribute('aria-expanded','false');
 await service.focus();await service.press('Enter');await service.press('Tab');
 await expect(service).toHaveAttribute('aria-expanded','false');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
});
