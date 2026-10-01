import fsSync from 'node:fs';
import path from 'node:path';

export const repoRootDir = path.resolve(import.meta.dirname, '..');
export const srcDir = path.join(repoRootDir, 'src');

/**
 * The package.json version for this package. Published builds of
 * this package use a generated baked-in string for this, but
 * during local development it's loaded on the fly
 */
export const pkgVersion: string = ((v: string) => {
  // use the baked-in string if it's not the placeholder
  if (v.charAt(0) !== '[') return v;

  return loadJson(path.join(repoRootDir, 'package.json')).version;
})('[VERSION_PLACEHOLDER]');

function loadJson(filePath: string) {
  return JSON.parse(fsSync.readFileSync(filePath, 'utf-8'));
}

/** Used for baking the value at build-time */
export function _bakeVersion() {
  const { version } = loadJson(path.join(repoRootDir, 'package.json'));
  if (!version) throw new Error(`Unable to resolve version`);

  const tsConfig = loadJson(path.join(repoRootDir, 'tsconfig.json'));
  const distDir = tsConfig.compilerOptions.outDir as string;
  if (!distDir) throw new Error(`Unable to resolve distDir`);

  const modPath = path.relative(srcDir, import.meta.filename);
  const distModPath = path.join(distDir, modPath).replace('.ts', '.js');

  const modContent = fsSync.readFileSync(distModPath, 'utf-8');
  fsSync.writeFileSync(
    distModPath,
    modContent.replace('\x5BVERSION_PLACEHOLDER\x5D', version)
  );
}
