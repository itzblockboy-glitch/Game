/**
 * Copies the exact three.js ESM modules the client imports into src/vendor/ so the
 * game ships as plain static files (no bundler, no CDN, works offline). Runs on
 * postinstall and before dev/build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules/three');
const OUT = path.join(ROOT, 'src/vendor');

const FILES = [
  ['build/three.module.js', 'three.module.js'],
  ['build/three.core.js', 'three.core.js'],
  ['examples/jsm/loaders/GLTFLoader.js', 'GLTFLoader.js'],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'BufferGeometryUtils.js'],
  ['examples/jsm/utils/SkeletonUtils.js', 'SkeletonUtils.js'],
  ['examples/jsm/controls/OrbitControls.js', 'OrbitControls.js'],
  ['examples/jsm/loaders/DRACOLoader.js', 'DRACOLoader.js'],
  ['examples/jsm/libs/meshopt_decoder.module.js', 'meshopt_decoder.module.js'],
];

fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [src, dst] of FILES) {
  const from = path.join(NM, src);
  if (!fs.existsSync(from)) {
    console.warn(`  ! missing ${src}`);
    continue;
  }
  let code = fs.readFileSync(from, 'utf8');
  // rewrite bare specifiers so everything resolves as sibling static files
  code = code
    .replace(/from\s+['"]three['"]/g, "from './three.module.js'")
    .replace(/from\s+['"]\.\.\/utils\/BufferGeometryUtils\.js['"]/g, "from './BufferGeometryUtils.js'")
    .replace(/from\s+['"]\.\.\/libs\/meshopt_decoder\.module\.js['"]/g, "from './meshopt_decoder.module.js'")
    .replace(/from\s+['"]\.\.\/controls\/OrbitControls\.js['"]/g, "from './OrbitControls.js'")
    .replace(/from\s+['"]\.\.\/utils\/SkeletonUtils\.js['"]/g, "from './SkeletonUtils.js'");
  fs.writeFileSync(path.join(OUT, dst), code);
  n++;
}
// keep Draco decoders in sync too
const dracoSrc = path.join(NM, 'examples/jsm/libs/draco/gltf');
const dracoOut = path.join(ROOT, 'public/draco');
fs.mkdirSync(dracoOut, { recursive: true });
for (const f of fs.readdirSync(dracoSrc)) {
  fs.copyFileSync(path.join(dracoSrc, f), path.join(dracoOut, f));
}
console.log(`  vendor: ${n} three.js modules synced → src/vendor/, draco decoders → public/draco/`);
