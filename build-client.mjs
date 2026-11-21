// Build client.js for the bundle: wrap the verified drag-sort engine
// (the exact file the temp harness loads) into the DSH client module format.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const engine = readFileSync(join(here, 'engine.js'), 'utf8').trimEnd();

const banner = `/**
 * DSH plugin: dsh-model-drag — client half.
 * Generated from engine.js by build-client.mjs; edit engine.js and rebuild.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-drag',
  factory: (require) => {
`;

const footer = `
    const api = window.DshModelDragSort;
    if (!api) throw new Error('dsh-model-drag: engine failed to install');
    return {
      inject: [],
      apply(ctx) {
        const instance = api.install();
        if (ctx && typeof ctx.effect === 'function') {
          // ctx.effect runs its callback now; the RETURN value becomes the cleanup.
          ctx.effect(() => instance.dispose);
        }
      },
    };
  },
});
`;

// Indent the engine two spaces to sit inside the factory.
const indented = engine
  .split('\n')
  .map((line) => (line.length ? '  ' + line : line))
  .join('\n');

writeFileSync(join(here, 'client.js'), banner + indented + footer);
console.log('client.js written:', (banner + indented + footer).length, 'bytes');
