/*
 * Module graph check.
 *
 * Serves as the "does the page still load" guard: it walks every relative import
 * reachable from index.html's entry point over HTTP and fails on a 404, so a
 * renamed or mistyped path is caught here instead of blanking the page in a
 * browser. Bare specifiers (three) are not fetched — they must be declared in the
 * importmap, which is also checked.
 *
 *   node tests/modules.check.mjs [baseUrl]
 */

const base = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/$/, '');

const get = async (path) => {
  const res = await fetch(base + '/' + path);
  if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
  return res.text();
};

const html = await get('index.html');

const entryMatch = html.match(/<script type="module" src="([^"]+)"/);
if (!entryMatch) throw new Error('index.html has no <script type="module"> entry point');

const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
const imports = mapMatch ? (JSON.parse(mapMatch[1]).imports || {}) : {};

const seen = new Set();
const bare = new Set();

async function walk(path) {
  if (seen.has(path)) return;
  seen.add(path);
  const source = await get(path);
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      bare.add(specifier);
      continue;
    }
    await walk(new URL(specifier, 'http://local/' + dir).pathname.slice(1));
  }
}

await walk(entryMatch[1]);

const unmapped = [...bare].filter((specifier) => !imports[specifier]);
if (unmapped.length) {
  throw new Error('bare specifier(s) missing from the importmap: ' + unmapped.join(', '));
}

console.log('entry            : ' + entryMatch[1]);
console.log('local modules    : ' + seen.size + ' (all fetched)');
console.log('bare specifiers  : ' + ([...bare].map((s) => s + ' → ' + imports[s]).join(', ') || 'none'));
console.log('\nOK: every import resolves');
