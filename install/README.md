# Putting MediPOS on a shop computer

MediPOS runs on the shop's own machine. It needs **Node 20 or newer** and nothing
else — no database, no internet, no `node_modules` on the till.

## 1. Build the shop folder

On your own machine, from the project:

```bash
npm install
npm run build
npm run package
```

That produces `medipos-shop/` — about **440 KB**. Copy that folder to the shop
computer (USB stick is fine).

## 2. Install Node on the shop computer

Download the LTS installer from <https://nodejs.org> and run it. One time only.

## 3. Start it

| System | How |
| --- | --- |
| Windows | Double-click `start.bat` |
| macOS / Linux | `./start.sh` |

Then open <http://localhost:4173>. The first screen sets up the people on the till:

- **you**, the owner — your name and your own passcode, which unlocks everything;
- optionally a **counter** person, who bills and looks up stock but cannot cancel
  bills, see takings, change prices or open Settings.

Everyone gets their own passcode, because that is how a bill records who rang it up.
Add the rest of your staff in Settings → People on the till. When someone on the
counter needs something owner-only, MediPOS asks for an owner passcode on the spot, so
you approve it without anyone signing out.

## 4. Make it start by itself

So nobody has to open a terminal each morning:

| System | Command |
| --- | --- |
| Linux | `sudo ./install/install-linux.sh` |
| macOS | `./install/install-macos.sh` |
| Windows | Right-click `install\install-windows.ps1` → Run with PowerShell |

Each one registers MediPOS to start at boot or login and to **restart itself if it
crashes or the power cuts out**.

## 5. Make it open like a till

Put a desktop shortcut to `install/kiosk-windows.bat` (or `kiosk-linux.sh`) on the
counter machine. It opens MediPOS in its own window with no address bar or tabs, so
staff can't wander off into a browser.

## 6. Set up backups — do not skip this

Settings → Automatic backups. A copy is written every time MediPOS starts and then on
a schedule.

**Point the backup folder at a USB stick or a synced folder** (Dropbox, Google Drive,
OneDrive). A backup that only exists on the till is no backup at all: the realistic
disaster is the laptop being stolen, dropped or dying, and taking both copies with it.

Check the folder path in Settings shows recent backups with sensible sizes. If the
drive is unplugged, MediPOS says so there and keeps trading — a missing backup drive
never stops you selling.

## 7. Receipt printer

Receipts print through the browser's print dialog, laid out for **80 mm thermal
paper**. Install the printer in the operating system as usual, then:

- Set it as the default printer.
- In the browser's print dialog set paper to 80 mm roll and margins to **None**.
- Print a test bill and check nothing is cut off at the right edge.

## Day-to-day

| Thing | Where |
| --- | --- |
| Data file | `server/data/db.json` |
| Backups | The folder set in Settings |
| Passcodes | `server/data/auth.json` — delete it and restart to set new ones |
| Logs (Linux) | `/var/log/medipos.log` |
| Logs (macOS) | `~/Library/Logs/medipos.log` |
| Change port | `PORT=4174` before starting |
| Turn off the passcode | `POS_AUTH=off` before starting |

## Using it from a second device

MediPOS listens on the whole network, so a phone or tablet on the same Wi-Fi can
reach it at `http://<the computer's IP>:4173`. The passcode is the only thing
protecting it, so:

- Use a passcode you would be happy defending, not `1234`.
- On an untrusted network, bind it to the machine only: `HOST=127.0.0.1`.

Give each person their own passcode and never share one: bills record who rang them
up, and two people on one code would make that meaningless. Settings → Activity shows
cancelled bills, price changes and the rest, with the name against each.

## Updating

Rebuild and re-package on your machine, then copy the new `server/` and `dist/`
folders over the old ones. **Leave `server/data/` alone** — that is the shop's
records. Restart MediPOS afterwards.
