import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(desktopDirectory, '..');
const outputDirectory = resolve(projectDirectory, '.desktop-dist');
const expectedOutputDirectory = join(projectDirectory, '.desktop-dist');

if (outputDirectory !== expectedOutputDirectory) {
  throw new Error('Refusing to clean an unexpected desktop output directory.');
}

await rm(outputDirectory, {
  recursive: true,
  force: true
});

await mkdir(join(outputDirectory, 'renderer'), {
  recursive: true
});

await Promise.all([
  build({
    entryPoints: [join(desktopDirectory, 'main.ts')],
    outfile: join(outputDirectory, 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    packages: 'external',
    external: ['electron'],
    logLevel: 'info'
  }),
  build({
    entryPoints: [join(desktopDirectory, 'preload.ts')],
    outfile: join(outputDirectory, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    logLevel: 'info'
  }),
  build({
    entryPoints: [join(desktopDirectory, 'renderer', 'app.ts')],
    outfile: join(outputDirectory, 'renderer', 'app.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome150',
    logLevel: 'info'
  })
]);

await Promise.all([
  copyFile(
    join(desktopDirectory, 'renderer', 'index.html'),
    join(outputDirectory, 'renderer', 'index.html')
  ),
  copyFile(
    join(desktopDirectory, 'renderer', 'styles.css'),
    join(outputDirectory, 'renderer', 'styles.css')
  ),
  copyFile(
    join(projectDirectory, 'site', 'assets', 'checkquest-icon-512.png'),
    join(outputDirectory, 'renderer', 'checkquest-icon.png')
  )
]);
