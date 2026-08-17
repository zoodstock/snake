/*
 * Bundle the game into one self-contained HTML file.
 *
 *   node tools/bundle.js                      -> dist/blocksnake.html  (standalone)
 *   node tools/bundle.js --fragment out.html  -> body-only fragment, for hosts that
 *                                                supply their own <!doctype>/<head>
 *
 * Every <script src> is inlined verbatim, so the bundle behaves exactly like
 * index.html and can be opened, emailed or hosted anywhere on its own.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const outArg = args.find((a) => !a.startsWith('--'));
const outPath = path.resolve(root, outArg || (fragment ? 'dist/blocksnake.fragment.html' : 'dist/blocksnake.html'));

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let inlined = 0;
const bundled = html.replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g, (match, src) => {
  const file = path.join(root, src);
  const code = fs.readFileSync(file, 'utf8');
  if (code.includes('</script')) {
    throw new Error(src + ' contains a literal </script> and cannot be inlined');
  }
  inlined++;
  return '<script>\n/* ' + src + ' */\n' + code.trimEnd() + '\n</script>\n';
});

if (inlined === 0) throw new Error('no <script src> tags found — did index.html change?');

let output = bundled;
if (fragment) {
  // Keep <title> and <style> (hosts merge them into their own head), drop the
  // document scaffolding the host provides.
  const title = (bundled.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
  const style = (bundled.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  const body = (bundled.match(/<body>([\s\S]*)<\/body>/) || ['', ''])[1];
  output = [title, style, body.trim(), ''].filter(Boolean).join('\n');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output);

const kb = (Buffer.byteLength(output) / 1024).toFixed(1);
console.log('bundled ' + inlined + ' scripts -> ' + path.relative(root, outPath) + ' (' + kb + ' KB)');
