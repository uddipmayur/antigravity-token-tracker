const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

async function build() {
  // Ensure dist directory exists
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  // Copy CSS to dist
  fs.copyFileSync('src/webview/styles.css', 'dist/styles.css');

  // Build Extension Host Bundle (Node CJS)
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    minify: !isWatch,
  });

  // Build Webview Client Bundle (Browser IIFE)
  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/webviewApp.ts'],
    bundle: true,
    outfile: 'dist/webviewApp.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    minify: !isWatch,
  });

  if (isWatch) {
    console.log('[esbuild] Watching for changes...');
    await extensionCtx.watch();
    await webviewCtx.watch();
  } else {
    await extensionCtx.rebuild();
    await webviewCtx.rebuild();
    await extensionCtx.dispose();
    await webviewCtx.dispose();
    console.log('[esbuild] Build completed successfully.');
  }
}

build().catch((err) => {
  console.error('[esbuild] Build failed:', err);
  process.exit(1);
});
