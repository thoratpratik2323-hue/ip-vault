import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let vaultKey = null;
const VAULT_DIR = path.join(app.getPath('userData'), 'vault_data');
const METADATA_PATH = path.join(VAULT_DIR, 'metadata.json.enc');

// Ensure vault directory exists
if (!fs.existsSync(VAULT_DIR)) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    titleBarStyle: 'hidden',
    backgroundColor: '#000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  
  // Open DevTools for development
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- SECURITY LOGIC (Main Process side) ---

// 1. Vault Unlock (Key Derivation)
ipcMain.handle('lock-vault', async () => {
  vaultKey = null;
  console.log(`[VAULT] Vault key cleared.`);
  return { success: true };
});

ipcMain.handle('vault-unlock', async (event, password) => {
  // Use Scrypt for heavy key derivation (prevents brute forcing)
  try {
    vaultKey = crypto.scryptSync(password, 'aurora-salt-secure-2026', 32); 
    // In a real app, we'd verify the password against a stored hash
    // For this demo, we'll assume the password is the key
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 2. Encryption/Decryption Helpers
function encrypt(buffer) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decrypt(data) {
  const iv = data.slice(0, 16);
  const tag = data.slice(16, 32);
  const encrypted = data.slice(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// 3. File Operations
ipcMain.handle('save-file', async (event, filePath) => {
  if (!vaultKey) throw new Error("Vault locked");
  
  const fileContent = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const encryptedContent = encrypt(fileContent);
  
  const targetId = crypto.randomUUID();
  const targetPath = path.join(VAULT_DIR, targetId + '.enc');
  
  await fs.writeFile(targetPath, encryptedContent);
  
  return { id: targetId, name: fileName, size: fileContent.length, type: path.extname(fileName) };
});

ipcMain.handle('read-file', async (event, fileId) => {
    if (!vaultKey) throw new Error("Vault locked");
    const filePath = path.join(VAULT_DIR, fileId + '.enc');
    const encryptedData = await fs.readFile(filePath);
    const decryptedData = decrypt(encryptedData);
    return decryptedData.toString('base64'); // Return as base64 for renderer
});

ipcMain.handle('download-file', async (event, { id, originalName }) => {
    if (!vaultKey) throw new Error("Vault locked");
    
    // 1. Decrypt data
    const filePath = path.join(VAULT_DIR, id + '.enc');
    const encryptedData = await fs.readFile(filePath);
    const decryptedData = decrypt(encryptedData);
    
    // 2. Ask where to save
    const { canceled, filePath: targetPath } = await dialog.showSaveDialog({
        defaultPath: originalName,
        title: 'Restore Secure Asset'
    });
    
    if (canceled) return { success: false };
    
    // 3. Write back
    await fs.writeFile(targetPath, decryptedData);
    return { success: true, path: targetPath };
});

ipcMain.handle('delete-file', async (event, fileId) => {
    if (!vaultKey) throw new Error("Vault locked");
    const filePath = path.join(VAULT_DIR, fileId + '.enc');
    try {
        if (await fs.pathExists(filePath)) {
            await fs.remove(filePath);
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-metadata', async (event, metadata) => {
    if (!vaultKey) throw new Error("Vault locked");
    console.log(`[VAULT] Saving metadata to ${METADATA_PATH}`);
    const encrypted = encrypt(Buffer.from(JSON.stringify(metadata)));
    await fs.writeFile(METADATA_PATH, encrypted);
    return { success: true };
});

ipcMain.handle('load-metadata', async (event) => {
    if (!vaultKey) throw new Error("Vault locked");
    console.log(`[VAULT] Loading metadata from ${METADATA_PATH}`);
    if (!await fs.pathExists(METADATA_PATH)) {
        console.log(`[VAULT] Metadata file not found.`);
        return { files: [], logs: [], notes: [] };
    }
    try {
        const encryptedData = await fs.readFile(METADATA_PATH);
        const decryptedData = decrypt(encryptedData);
        console.log(`[VAULT] Metadata decrypted successfully.`);
        return JSON.parse(decryptedData.toString());
    } catch (e) {
        console.error(`[VAULT] Metadata decryption FAILED (Bad Key):`, e.message);
        return null; 
    }
});

ipcMain.handle('select-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections']
    });
    if (canceled) return null;
    return filePaths;
});
