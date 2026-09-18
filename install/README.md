# Putting Dawakhana in a shop

Two steps on the shop computer, then a desktop icon staff double-click.

## What you do, once, on your own machine

```bash
npm install
npm run build
npm run package
```

That produces **`dawakhana-shop.zip`**, about 270 KB. Node is never bundled: it
is installed on the shop computer once, separately, from nodejs.org. That keeps
the package small enough to email or send over any connection, and keeps Node
patching the shop's own business rather than something re-shipped with every
update.

## What the shop does

**Unzip the folder and run the setup file.** That is the whole install.

| System | Double-click |
| --- | --- |
| Windows | `SETUP-Windows.bat` |
| Mac | `SETUP-Mac.command` |
| Linux | `./SETUP-Linux.sh` |

It puts a **Dawakhana icon on the desktop** and asks whether to open the till
automatically whenever the computer is switched on.

**That's it.** Double-clicking the icon starts the till if it isn't running and
opens it in its own window — no terminal, no address bar, no tabs to get lost in.

The first time, it asks who works the till: the owner's name and passcode, and
optionally a counter person for staff.

### Why a `.vbs` on Windows

A `.bat` leaves a black console window on screen, which staff close — killing
the till mid-queue. The `.vbs` launcher runs the server hidden and only ever
shows the app window.

### Which Node gets used

Whatever `node` is on the computer's PATH. The setup script checks it is version
20 or newer and refuses to continue otherwise, and the server checks again each
time it starts, so a wrong version produces a clear message rather than a crash.

## Then: backups. Do not skip this.

**Settings → Automatic backups → Backup folder.** Point it at a **USB stick or a
synced folder** (Google Drive, OneDrive, Dropbox).

Everything the shop knows is one file on one computer. Backing it up to the same
computer is not a backup: the realistic disaster is that machine being stolen,
dropped or dying, and taking both copies with it.

Check the folder shows recent backups with sensible sizes. If the drive is
unplugged, Settings says so and the shop keeps trading — a missing backup drive
never stops a sale.

## Receipt printer

Receipts print through the browser's print dialog, laid out for **80 mm thermal
paper**.

1. Install the printer in Windows/macOS as usual and set it as the default.
2. Ring up a test bill and press Print.
3. In the print dialog set paper to the 80 mm roll and margins to **None**.
4. Check nothing is clipped on the right edge.

## Day to day

| Thing | Where |
| --- | --- |
| Shop records | `server/data/db.json` |
| Backups | The folder set in Settings |
| Passcodes | `server/data/auth.json` — delete it and restart to start again |
| Log | `server/data/dawakhana.log` |
| Change port | `PORT=4174` before starting |
| Turn the passcode off | `POS_AUTH=off` before starting |

The till keeps running in the background after the window is closed, so
reopening it is instant. Restarting the computer stops it.

### Running it properly as a service

The desktop icon is enough for a beta. For a permanent install that restarts
itself after a crash or a power cut, there are service installers:

```bash
sudo ./install/service-linux.sh     # systemd, Restart=always
./install/service-macos.sh          # launchd, KeepAlive
```

On Windows, the setup script's "start automatically" option covers this.

## A second device

Dawakhana listens on the whole network, so a phone or tablet on the same Wi-Fi can
reach it at `http://<the computer's IP>:4173`. Passcodes are the only thing in
the way — use `HOST=127.0.0.1` to bind to the machine alone.

## Updating the shop later

Rebuild and re-package on your machine, then copy the new `server/` and `dist/`
folders over the old ones. **Leave `server/data/` alone** — that is the shop's
records. Close and reopen Dawakhana afterwards.
