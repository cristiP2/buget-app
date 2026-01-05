const { app, BrowserWindow } = require('electron')

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    // Start maximized instead of fullscreen so native window controls remain available
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true
    }
  })

  // AICI este partea importantă: încarcă fișierul tău HTML
  win.loadFile('index.html')
  
  // Scoate meniul de sus (File, Edit etc.) pentru un aspect mai curat
  win.setMenuBarVisibility(false)
  // Maximizăm pentru a ocupa ecranul, păstrând controalele native vizibile
  win.maximize();
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})