/**
 * Pravi build/icon.ico iz PNG-a (Windows: installer, exe, taskbar).
 * Izvor: public/pwa-icon-512.png — zameni taj PNG ili promeni putanju ispod.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const sourcePng = path.join(root, "public", "pwa-icon-512.png");
const outIco = path.join(root, "build", "icon.ico");

async function main() {
  // png-to-ico v3 je ESM — require() vraća { default }, ne funkciju
  const { default: pngToIco } = await import("png-to-ico");
  const input = fs.readFileSync(sourcePng);
  const ico = await pngToIco(input);
  fs.mkdirSync(path.dirname(outIco), { recursive: true });
  fs.writeFileSync(outIco, ico);
  console.log("Electron icon:", outIco);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
