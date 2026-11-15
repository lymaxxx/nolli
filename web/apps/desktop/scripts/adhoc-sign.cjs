/*
 * electron-builder "afterPack" hook: gives the macOS app an ad-hoc signature.
 *
 * Apple Silicon refuses to run an app with no signature at all. An ad-hoc
 * signature ("-") is not an identity and does not satisfy Gatekeeper, so the
 * app still shows an "unidentified developer" warning; it only lets the app
 * start once the user has approved it. A real Developer ID signature and
 * notarisation replace this: set CSC_LINK / CSC_KEY_PASSWORD (and remove
 * `mac.identity: null` from package.json), and this hook steps aside.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  if (process.platform !== 'darwin') {
    console.log('  • skipping ad-hoc signing: codesign only exists on macOS');
    return;
  }
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
