import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DefaultAddons, maybeDownloadAddons } from "camoufox-js/dist/addons.js";
import { ALLOW_GEOIP, downloadMMDB } from "camoufox-js/dist/locale.js";
import { CamoufoxFetcher, INSTALL_DIR, OS_NAME, installedVerStr } from "camoufox-js/dist/pkgman.js";
import { getAsBooleanFromENV } from "camoufox-js/dist/utils.js";

const { version, release } = JSON.parse(
  readFileSync(new URL("./browser-version.json", import.meta.url), "utf8"),
);
const browserVersion = `${version}-${release}`;

// The adapter's broad supported range also accepts newer, incompatible schemas.
// Keep its installer, but select the exact browser release shared by both modes.
class PinnedCamoufoxFetcher extends CamoufoxFetcher {
  async getAsset() {
    const url = `https://api.github.com/repos/daijro/camoufox/releases/tags/v${browserVersion}`;
    const response = await fetch(url, {
      headers: process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {},
    });
    if (!response.ok) {
      throw new Error(`Could not fetch Camoufox v${browserVersion}: HTTP ${response.status}.`);
    }
    const metadata = await response.json();
    const name = `camoufox-${browserVersion}-${OS_NAME}.${this.arch}.zip`;
    const asset = metadata.assets.find((candidate) => candidate.name === name);
    const match = asset && this.checkAsset(asset);
    if (!match) {
      throw new Error(`Camoufox v${browserVersion} has no supported asset ${name}.`);
    }
    return match;
  }
}

if (getAsBooleanFromENV("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", false)) {
  console.log("Skipping browser download due to PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD set!");
} else if (existsSync(join(INSTALL_DIR.toString(), "version.json"))
  && installedVerStr() === browserVersion) {
  console.log(`Camoufox v${browserVersion} is already installed.`);
} else {
  await new PinnedCamoufoxFetcher().install();
}
if (ALLOW_GEOIP) await downloadMMDB();
await maybeDownloadAddons(DefaultAddons);
