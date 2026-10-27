import test from 'node:test';
import assert from 'node:assert/strict';

const checkerPath = '../scripts/check-architecture.mjs';
const { checkFile } = await import(checkerPath);

for (const separator of ['/', '\\']) {
  const file = (value: string) => value.replaceAll('/', separator);
  test(`architecture checks allow shared primitives and theme files with ${separator} paths`, () => {
    assert.deepEqual(checkFile(file('src/components/ui/Button.tsx'), 'export const Button = () => <button />;'), []);
    assert.deepEqual(checkFile(file('src/theme/tokens.css'), ':root { --colour: #fff; }'), []);
    assert.deepEqual(checkFile(file('src/catalogue/Catalogue.tsx'), 'window.alert("demo");'), []);
  });
  test(`architecture checks still reject violations with ${separator} paths`, () => {
    assert.match(checkFile(file('src/features/example/View.tsx'), 'export const View = () => <button />;').join('\n'), /shared component/);
    assert.match(checkFile(file('src/features/example/view.css'), '.view { color: #fff; }').join('\n'), /literal colours/);
    assert.match(checkFile(file('src/components/ui/Button.tsx'), "import { View } from '../../features/example/View';").join('\n'), /cannot import feature/);
    assert.match(checkFile(file('src/features/example/View.tsx'), 'window.confirm("continue?");').join('\n'), /shared dialog/);
  });
}
