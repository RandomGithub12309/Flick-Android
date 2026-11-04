#!/usr/bin/env sh
# Put Flick's server on this device and start it.
#
# Run this in Termux, after copying over the folder (or tarball) that
# `npm run phone:push` produced on a laptop:
#
#   sh ~/Download/phone-install.sh                  # finds the tarball/folder
#   sh ~/Download/phone-install.sh ~/Download/flick-server
#   sh ~/Download/phone-install.sh --boot           # also start on device boot
#
# It installs Node if missing, moves the build into ~/flick-server, puts a
# `flick` command on PATH, starts the server and opens the app. It deliberately
# does NOT run npm or build anything here: the artifact is a Nitro bundle that
# already contains every dependency, and Termux's Node cannot load the glibc
# native modules a real build of this repo wants. Copying the output instead of
# building on-device is what makes this a two-minute job rather than a weekend.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
TARGET="$HOME/flick-server"
BOOT=0
SOURCE=""

for arg in "$@"; do
  case "$arg" in
    --boot) BOOT=1 ;;
    --help | -h)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *) SOURCE="$arg" ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "installing node…"
  pkg install -y nodejs
fi

# Where the build is: an argument, the shared-download folder, or this script's
# own directory (the tarball unpacks next to it).
if [ -z "$SOURCE" ]; then
  # The shapes a copy-paste leaves you in: unzipped into Downloads, unzipped
  # wherever the shell happened to be, or run from inside the folder itself.
  for candidate in \
    "$HOME/Download/flick-server" \
    "$HOME/Download/flick-server.tar.gz" \
    "$HERE" \
    "$HERE/flick-server.tar.gz" \
    "$HERE/../flick-server.tar.gz" \
    "$PWD/flick-server" \
    "$PWD/flick-server.tar.gz"; do
    if [ -e "$candidate" ]; then
      SOURCE="$candidate"
      break
    fi
  done
fi

if [ -z "$SOURCE" ] || [ ! -e "$SOURCE" ]; then
  echo "no build found. Run \`npm run phone:push\` on a laptop and put" >&2
  echo "flick-server.tar.gz in Downloads, or pass its path as an argument." >&2
  exit 1
fi

case "$SOURCE" in
  *.tar.gz | *.tgz)
    echo "unpacking $SOURCE…"
    rm -rf "$TARGET.tmp"
    mkdir -p "$TARGET.tmp"
    tar -xzf "$SOURCE" -C "$TARGET.tmp"
    # The tarball wraps everything in a top-level folder; accept either shape.
    if [ -d "$TARGET.tmp/flick-server/.output" ]; then
      rm -rf "$TARGET"
      mv "$TARGET.tmp/flick-server" "$TARGET"
      rm -rf "$TARGET.tmp"
    elif [ -d "$TARGET.tmp/.output" ]; then
      rm -rf "$TARGET"
      mv "$TARGET.tmp" "$TARGET"
    else
      echo "that archive has no .output/ in it — it is not a Flick build." >&2
      rm -rf "$TARGET.tmp"
      exit 1
    fi
    ;;
  *)
    if [ "$(cd "$SOURCE" && pwd)" != "$TARGET" ]; then
      echo "copying $SOURCE → $TARGET…"
      rm -rf "$TARGET"
      cp -R "$SOURCE" "$TARGET"
    fi
    ;;
esac

if [ ! -f "$TARGET/.output/server/index.mjs" ]; then
  echo "$TARGET has no .output/server/index.mjs — it is not a Flick build." >&2
  exit 1
fi

# `flick` on PATH: Termux's bin dir is already on it, and a symlink would follow
# the caller's PATH into places the app cannot write.
BIN_DIR="${PREFIX:-$HOME/.termux}/bin"
mkdir -p "$BIN_DIR"
cat >"$BIN_DIR/flick" <<SHIM
#!/usr/bin/env sh
# Flick's on-device server — built by 'npm run build:phone', copied by
# 'npm run phone:push'. Re-run phone-install.sh after every push.
exec node "$TARGET/phone-server.mjs" "\$@"
SHIM
chmod +x "$BIN_DIR/flick"

if [ "$BOOT" -eq 1 ]; then
  # Termux:Boot runs whatever is in ~/.termux/boot when the device finishes
  # booting. Without that app installed the file simply never runs — harmless.
  mkdir -p "$HOME/.termux/boot"
  cat >"$HOME/.termux/boot/flick-server" <<'BOOTSH'
#!/usr/bin/env sh
$PREFIX/bin/flick start
BOOTSH
  chmod +x "$HOME/.termux/boot/flick-server"
  echo "autostart written (needs the Termux:Boot app to actually run it)"
fi

# Everything above is already done, so a server that will not come up must be
# reported as that — not as a script that died mid-sentence with its work done.
if ! "$BIN_DIR/flick" start; then
  echo
  echo "Installed, but the server did not come up. Look at the log, then start it:" >&2
  echo "  flick logs" >&2
  echo "  flick start" >&2
  exit 1
fi
URL=$("$BIN_DIR/flick" url)

if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "$URL"
fi

cat <<DONE

Flick is running on this device: $URL

In Chrome: menu → “Add to Home screen” (or “Install app”) gives you the
full-screen app with its own icon. If that prompt never appears, open
$URL/?install=1 for the manual route.

  flick status   is it up?
  flick logs     what did it say?
  flick stop     shut it down
  flick start    bring it back
DONE
