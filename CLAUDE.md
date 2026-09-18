# Dawakhana

A point of sale for a Pakistani retail pharmacy. React 19 + Vite + TypeScript on
the front, a zero-dependency Node HTTP server on the back, JSON file on disk.
It runs on one laptop behind the counter, offline, all day.

## Standing decisions

These came from the shop owner and hold until they say otherwise. Do not
relitigate them.

**Never bundle Node.** It is installed on the shop computer once, separately.
`npm run package` produces a ~270 KB zip and that is the only package we ship.
There is no `--with-node` flag, no `scripts/fetch-node.mjs`, no `runtime/`
directory in the package — all of that was removed deliberately, so do not
reintroduce it as a convenience.

**The product is Dawakhana.** It was MediPOS until that turned out to be a
product in Bangladesh. Do not reuse the old name anywhere; the one deliberate
exception is `LEGACY_PREFIXES` in `server/backup.mjs`, which keeps pre-rename
backups visible and prunable.

**Pakistan, not India.** Rupees (`Rs`, `PKR`), a single federal sales tax
back-calculated from tax-inclusive prices — never CGST/SGST. Tender types are
cash, card, digital (EasyPaisa / JazzCash / QR) and udhaar. Tax rates change
with each Finance Act, so the rate and the presets are configurable in Settings
and default to 0%.

**A shop's own data is never invented.** A fresh install gets the 50-medicine
starter catalogue, priced, with one `OPENING` batch per medicine holding zero
stock, and nothing else — no customers, no bills, no takings. Shop identity
fields (address, phone, drug licence, pharmacist, NTN/STRN) all start blank and
the receipt omits blanks rather than printing something made up. A licence
number or a pharmacist's name is a claim the shop makes to its regulator. The
invented shop lives behind `npm run seed:demo` and never goes to a shop.

## Layout

```
server/     zero-dependency Node: index.mjs (routing, auth, static),
            api.mjs (routes), db.mjs (atomic JSON store), auth.mjs (users,
            sessions), backup.mjs, seed.mjs, domain.mjs (money maths)
src/        React app — pages/, components/, lib/store.tsx
install/    setup + launcher per platform, icons
scripts/    package.mjs builds dawakhana-shop/ and the zip
```

## Working rules

- The server imports only `node:` built-ins. Keep it that way — it is why the
  shop needs no `node_modules`.
- Money is computed server-side on every path. A client never decides a bill.
- Roles are enforced route by route on the server, not just hidden in the UI.
  Staff cannot void, delete, see reports, edit prices or tax, or open Settings.
- Bills carry denormalised `soldBy`/`soldById` so history does not change when a
  user is renamed or removed.
- Anything touching the shop's data folder or a backup target must be
  time-boxed. An unplugged USB stick makes `fs` calls hang rather than fail, and
  a hung call freezes the till.

## Verifying

Reproduce before fixing, and prove the failure path, not just the happy one.
Bugs found exactly this way: a stalled backup mount hanging the till forever, a
focus-stealing modal effect, a tab-trap that leaked, PowerShell silently
stripping quotes out of a native command's arguments, and backup pruning that
would have deleted the newest files after the rename.

- `npm run build` typechecks and builds.
- `POS_DATA_DIR=<tmp> POS_AUTH=off PORT=<n> node server/index.mjs` runs a
  throwaway instance; use it rather than touching real data.
- Chromium for browser testing lives at `/opt/pw-browsers/`; PowerShell 7 is at
  `/opt/pwsh/pwsh` for checking the Windows setup script.
- `install/Dawakhana.vbs` cannot be executed here. Review it, say so plainly,
  and let the shop confirm on Windows.
