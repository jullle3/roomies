import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------- Detect root dir ---------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);  // always operate from repo root

/* ---------- Paths ---------- */
const SRC_DIR = 'roomies';  // your local source folder
const OUT_DIR = 'roomies';                  // build output folder
// const OUT_DIR = 'dist';                  // build output folder

const VERSION_PATTERN = /roomies_version=(\d+)/g;

function bumpAssetVersionInIndexHtml() {
    const indexPath = path.join(__dirname, 'index.html');
    const indexHtml = readFileSync(indexPath, 'utf8');

    const matches = [...indexHtml.matchAll(VERSION_PATTERN)];
    if (matches.length === 0) {
        throw new Error('No roomies_version value found in index.html');
    }

    const currentVersion = Number(matches[0][1]);
    const nextVersion = currentVersion + 1;

    const updatedHtml = indexHtml.replace(VERSION_PATTERN, `roomies_version=${nextVersion}`);
    writeFileSync(indexPath, updatedHtml, 'utf8');

    console.log(`🔖  Bumped roomies_version: ${currentVersion} -> ${nextVersion}`);
}

/* ---------- Clean old build ---------- */
// rmSync(OUT_DIR, { recursive: true, force: true });

/* ---------- Bundle + minify JS ---------- */
console.log('📦  Bundling JS…');
await build({
    entryPoints: [path.join(SRC_DIR, 'main.js')],   // main entry
    bundle: true,
    format: 'esm',
    minify: true,
    treeShaking: true,
    sourcemap: false,
    outfile: path.join(OUT_DIR, 'mergedJS.js'), // Output a single bundled file
    target: 'es2018',                      // modern browsers; adjust if needed
    loader: { '.js': 'js' },
    // exclude external remote libs we load via <script> tags
    external: ['nouislider', 'jquery', 'jquery-ui', 'wnumb', 'bootstrap']
});

console.log('🎨  Concatenating & minifying CSS…');

const cssFiles = [
    'thirdparty/bootstrap.min.css',
    'thirdparty/nouislider-14.7.0.min.css',
    'thirdparty/jquery-ui.css',
    // 'thirdparty/all.min.css',
    'globalStyles.css',
    'about_us/about_us.css',
    'header/header.css',
    'views/views.css',
    'housing_list/housing_list.css',
    'housing_detail/housing_detail.css',
    'housing_create/housing_create.css',
    'housing_map/housing_map.css',
    'conversations/conversations.css',
    'seller_profile/seller_profile.css',
    'blog/blog.css',
    'landing/landing.css',
    'landing_sell/landing_sell.css',
    // 'ai_analysis/ai_analysis.css',
    // 'ai_result/ai_result.css',
    'toast/toast.css',
    // Disabled themes for now, I didn't like ChatGPT first theme proposal.
    // Needs more thought...
    // 'theme.css'
].map(rel => path.join(SRC_DIR, rel));

let mergedCss = '';
for (const file of cssFiles) {
    mergedCss += readFileSync(file, 'utf8').trim() + '\n';
}

/* VERY lightweight minification: strip comments & excess whitespace.
 * For production‑grade minification, swap this out for a tool like cssnano
 * or esbuild‑css‑modules. */
mergedCss = mergedCss
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove comments
    .replace(/\s{2,}/g, ' ')              // collapse multiple spaces
    .replace(/\s*([{}:;,])\s*/g, '$1')   // trim space around symbols
    .replace(/;}/g, '}');                  // last semicolon optional

writeFileSync(path.join(OUT_DIR, 'mergedStyles.css'), mergedCss);
bumpAssetVersionInIndexHtml();

/* -------------------------------------------------------------------------- */
/*                                  Finished                                  */
/* -------------------------------------------------------------------------- */

console.log('✅  Build finished');
