import fs from 'node:fs';
import path from 'node:path';

/**
 * Bakes the package.json version into the built `constants.js`, so a
 * published build never reads package.json at runtime (which a browser
 * can't). Runs after `tsc`, and sits outside the build, so none of this is
 * reachable from the package entry.
 */

const repoRootDir = path.resolve(import.meta.dirname, '../..');
const placeholder = '\x5BVERSION_PLACEHOLDER\x5D';

function loadJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

const { version } = loadJson(path.join(repoRootDir, 'package.json'));
if (!version) throw new Error(`Unable to resolve version`);

const tsConfig = loadJson(path.join(repoRootDir, 'tsconfig.json'));
const distDir = tsConfig.compilerOptions.outDir as string;
if (!distDir) throw new Error(`Unable to resolve distDir`);

const distModPath = path.join(repoRootDir, distDir, 'constants.js');
const modContent = fs.readFileSync(distModPath, 'utf-8');
if (!modContent.includes(placeholder)) {
  throw new Error(`No version placeholder in ${distModPath}`);
}

fs.writeFileSync(distModPath, modContent.replace(placeholder, version));
