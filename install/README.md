# Putting Dawakhana in a shop

Two steps on the shop computer, then a desktop icon staff double-click.

## What you do, once, on your own machine

```bash
npm install
npm run build
npm run package -- --with-node=win-x64
```

That produces **`dawakhana-shop.zip`** (~34 MB) with an official Node runtime
inside, so **the shop installs nothing and needs no internet**. The runtime is
downloaded once, checksum-verified against nodejs.org's published
`SHASUMS256.txt`, and cached in `.node-cache/` for later builds.

Leave off `--with-node` for a ~270 KB package that relies on Node already being
installed on the shop computer.

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

The launcher prefers `runtime/win-x64/node.exe` from the package, and falls back
to a system Node only if that is missing. A shop machine therefore never depends
on what happens to be installed on it, and updating Dawakhana cannot be broken by
someone else upgrading or removing Node.

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
