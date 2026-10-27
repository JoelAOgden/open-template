import {test,expect} from '@playwright/test';
test('component catalogue exercises shared tabs, dropdowns, focus and confirmation',async({page})=>{
 await page.goto('/#components');await expect(page.getByRole('heading',{name:'Component catalogue'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Disabled',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Loading',exact:true})).toBeDisabled();
 const dropdown=page.getByRole('combobox',{name:'field dropdown'});
 await dropdown.focus();await dropdown.press('Enter');await dropdown.press('End');await dropdown.press('Enter');
 await expect(dropdown).toHaveAttribute('value','two');
 const confirm=page.getByRole('button',{name:'Open confirmation'});await confirm.click();
 const dialog=page.getByRole('dialog',{name:'Example confirmation'});await expect(dialog).toBeVisible();await dialog.press('Escape');await expect(dialog).toHaveCount(0);await expect(confirm).toBeFocused();
 const tab=page.getByRole('tab',{name:'Controls',exact:true});await tab.focus();await tab.press('ArrowRight');
 await expect(page.getByRole('tab',{name:'Feedback',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('alert')).toHaveText('Example error with an actionable explanation.');
 await page.getByRole('tab',{name:'Controls',exact:true}).click();await expect(dropdown).toHaveAttribute('value','two');
 await page.setViewportSize({width:900,height:700});await dropdown.click();const menu=page.getByRole('listbox',{name:'field dropdown'});const bounds=await menu.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(900);
 await dropdown.press('Escape');await page.screenshot({path:'output/ui-refactor/catalogue.png',fullPage:true});
});
