#!/bin/zsh
# Builds Nolli.app into macos/build/.
#
#   scripts/build.sh              # xcodebuild if the Xcode licence is accepted, else swiftc
#   FORCE_SWIFTC=1 scripts/build.sh   # skip Xcode, compile with the Command Line Tools
#   BUNDLE_ID=com.example.Nolli.test scripts/build.sh   # run a second copy next to the real one
#
# Requires macOS 26 and either Xcode or the Command Line Tools (xcode-select --install).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/build"
APP="$OUT/Nolli.app"
BUNDLE_ID="${BUNDLE_ID:-com.nolli.Nolli}"
mkdir -p "$OUT"

xcode_ok() {
  [[ -z "${FORCE_SWIFTC:-}" ]] \
    && DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1
}

if xcode_ok; then
  echo "==> xcodebuild"
  DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}" \
    xcodebuild -project Nolli.xcodeproj -scheme Nolli -configuration Release \
    -derivedDataPath "$OUT/DerivedData" build CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
  rm -rf "$APP"; cp -R "$OUT/DerivedData/Build/Products/Release/Nolli.app" "$APP"
else
  echo "==> swiftc (Xcode licence not accepted or FORCE_SWIFTC set)"
  SDK="$(xcrun --sdk macosx --show-sdk-path)"
  ARCH="$(uname -m)"
  rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
  swiftc -swift-version 5 -parse-as-library -sdk "$SDK" -target "$ARCH-apple-macos26.0" \
    -O -whole-module-optimization -module-name Nolli \
    -o "$APP/Contents/MacOS/Nolli" $(find Nolli -name "*.swift")
  # Info.plist from the source template, with Xcode's build variables filled in.
  sed -e 's/\$(EXECUTABLE_NAME)/Nolli/' -e 's/\$(PRODUCT_NAME)/Nolli/' \
      -e 's/\$(PRODUCT_BUNDLE_PACKAGE_TYPE)/APPL/' -e 's/\$(MACOSX_DEPLOYMENT_TARGET)/26.0/' \
      -e "s/\\\$(PRODUCT_BUNDLE_IDENTIFIER)/$BUNDLE_ID/" \
      Nolli/Resources/Info.plist > "$APP/Contents/Info.plist"
  printf 'APPL????' > "$APP/Contents/PkgInfo"
fi

# Ad-hoc signature so macOS will launch it locally (not notarised, not for distribution).
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP/Contents/Info.plist"
codesign --force --sign - "$APP"
echo "==> built $APP"
