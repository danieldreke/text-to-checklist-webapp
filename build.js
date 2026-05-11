const fs = require('fs').promises;
const path = require('path');

async function build() {
  const dist = 'dist';
  await fs.mkdir(dist, { recursive: true });
  await fs.mkdir(path.join(dist, 'icons'), { recursive: true });

  const [html, css, qrLib, js, sw] = await Promise.all([
    fs.readFile('index.html', 'utf8'),
    fs.readFile('styles.css', 'utf8'),
    fs.readFile('qrcodegen-nayuki.js', 'utf8'),
    fs.readFile('script.js', 'utf8'),
    fs.readFile('serviceworker.js', 'utf8'),
  ]);

  let out = html;
  out = out.replace(/<link rel="stylesheet" href="styles\.css[^"]*">/, `<style>\n${css}\n</style>`);
  out = out.replace(/\n\s*<script src="qrcodegen-nayuki\.js[^"]*"[^>]*><\/script>/, '');
  const safeJs = (qrLib + '\n' + js).replace(/<\/script>/gi, '<\\/script>');
  out = out.replace(/<script src="script\.js[^"]*"[^>]*><\/script>/, `<script>\n${safeJs}\n</script>`);

  let distSw = sw
    .replace(/\n\s*'\.\/styles\.css',?/g, '')
    .replace(/\n\s*'\.\/script\.js',?/g, '')
    .replace(/\n\s*'\.\/qrcodegen-nayuki\.js',?/g, '');

  const icons = await fs.readdir('icons');
  await Promise.all([
    fs.writeFile(path.join(dist, 'index.html'), out),
    fs.writeFile(path.join(dist, 'serviceworker.js'), distSw),
    fs.copyFile('manifest.json', path.join(dist, 'manifest.json')),
    ...icons.map(f => fs.copyFile(path.join('icons', f), path.join(dist, 'icons', f))),
  ]);

  console.log('Build complete → dist/');
}

build().catch(err => { console.error(err); process.exit(1); });
