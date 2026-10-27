import {test,expect} from '@playwright/test';
import path from 'node:path';
test('new project saves the document and recent projects restore it',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Project menu',exact:true}).focus();
 await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('menuitem',{name:'New project',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'Project menu',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Text',exact:true}).click();
 await page.getByPlaceholder('Write…').last().fill('Keep this across project switches.');
 await page.getByRole('button',{name:'Project menu',exact:true}).click();
 await page.getByRole('menuitem',{name:'New project',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Projects'});
 const original=await dialog.locator('.recent-projects button:disabled span').innerText();
 await dialog.getByLabel('Project name',{exact:true}).fill('second-project');
 await dialog.getByLabel('Project folder path').fill(path.dirname(original));
 await dialog.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Project menu',exact:true})).toContainText('second-project');
 await page.getByRole('button',{name:'Project menu',exact:true}).click();
 await page.getByRole('menuitem',{name:'Open existing',exact:true}).click();
 await dialog.getByLabel('Project folder path').fill(original);
 await dialog.getByRole('button',{name:'Open project',exact:true}).click();
 await expect(page.getByPlaceholder('Write…').last()).toHaveValue('Keep this across project switches.');
});

test('no selected project locks the workspace to project setup',async({page})=>{
 let original='';
 await page.route('**/api/projects',async route=>{
   const response=await route.fetch();const data=await response.json();original=data.current.path;
   await route.fulfill({json:{...data,current:null}});
 });
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Create new project',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Project menu',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Close projects',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('heading',{name:'Create new project',exact:true})).toBeVisible();
 await page.unroute('**/api/projects');
 await page.getByLabel('Project name',{exact:true}).fill('welcome-project');
 await page.getByLabel('Project folder path').fill(path.dirname(original));
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.getByRole('button',{name:'Project menu',exact:true})).toContainText('welcome-project');
});
