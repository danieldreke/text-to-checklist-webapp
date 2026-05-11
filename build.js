const fs = require('fs');
const path = require('path');

const dist = 'dist';
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });

let html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const js = fs.readFileSync('script.js', 'utf8');

html = html.replace(
  /<link rel="stylesheet" href="styles\.css[^"]*">/,
  `<style>\n${css}\n</style>`
);

const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
html = html.replace(
  /<script src="script\.js[^"]*"[^>]*><\/script>/,
  `<script>\n${safeJs}\n</script>`
);

fs.writeFileSync(path.join(dist, 'index.html'), html);

// Strip inlined assets from SW cache list
let sw = fs.readFileSync('serviceworker.js', 'utf8');
sw = sw.replace(/\n\s*'\.\/styles\.css',?/g, '');
sw = sw.replace(/\n\s*'\.\/script\.js',?/g, '');
fs.writeFileSync(path.join(dist, 'serviceworker.js'), sw);

for (const file of ['manifest.json', 'qrcodegen-nayuki.js']) {
  fs.copyFileSync(file, path.join(dist, file));
}
for (const file of fs.readdirSync('icons')) {
  fs.copyFileSync(path.join('icons', file), path.join(dist, 'icons', file));
}

console.log('Build complete → dist/');
