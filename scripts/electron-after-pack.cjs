/**
 * Ugrađuje build/icon.ico u glavni .exe posle pakovanja.
 * (Kad je signAndEditExecutable isključen, electron-builder ne menja resurse exe-a,
 * pa Windows prečica na desktopu ostaje na podrazumevanoj Electron ikoni.)
 */
const fs = require("fs");
const path = require("path");
const rcedit = require("rcedit");

module.exports = async function electronAfterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");

  if (!fs.existsSync(exePath)) {
    console.warn("[electron-after-pack] Exe not found:", exePath);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn("[electron-after-pack] Icon not found:", iconPath);
    return;
  }

  await rcedit(exePath, { icon: iconPath });
  console.log("[electron-after-pack] Icon embedded:", exePath);
};
