const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:8080";

function getWindowIconPath() {
  if (process.platform !== "win32") return undefined;
  const packaged = path.join(process.resourcesPath, "app-icon.ico");
  const dev = path.join(__dirname, "..", "build", "icon.ico");
  const p = app.isPackaged ? packaged : dev;
  try {
    if (fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return undefined;
}

function createWindow() {
  const icon = getWindowIconPath();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (app.isPackaged) {
    const indexHtml = path.join(__dirname, "..", "dist", "index.html");
    void win.loadFile(indexHtml);
  } else {
    void win.loadURL(DEV_URL);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
