// Builds a signed release APK. Used by the GitHub Action and on a laptop.
// Needs these environment variables:
//   KEYSTORE_PATH      path to the .jks signing key
//   KEYSTORE_PASSWORD  its password
//   BUILD_NUMBER       a number that goes up every build (GitHub supplies it)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const APK_NAME = "laptop-cam.apk";
const ICON = "icon-512.png";                     // the website's own icon
const ORIENTATION = null;                        // null = the screen turns freely (watch in landscape)
const PERMISSIONS = ["POST_NOTIFICATIONS", "VIBRATE", "CAMERA", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"];  // camera + mic for "Be the camera"
const INNER = 760;                               // how big the icon sits inside the 1024 Android icon

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const repo = path.resolve(here, "..");
const run = (cmd) => execSync(cmd, { cwd: here, stdio: "inherit" });
const need = (name) => {
  if (!process.env[name]) throw new Error(`Missing environment variable ${name}`);
  return process.env[name];
};

const keystore = path.resolve(need("KEYSTORE_PATH"));
need("KEYSTORE_PASSWORD");
const build = parseInt(process.env.BUILD_NUMBER || "1", 10);
const { default: sharp } = await import("sharp");
const services = path.join(here, "google-services.json");      // links the app to Firebase for notifications
if (!fs.existsSync(services)) throw new Error("google-services.json is missing (needed for notifications)");

// The colour at the icon's left edge becomes the background behind the Android icon and the splash screen
const iconPath = path.join(repo, ICON);
const { data } = await sharp(iconPath).resize(512, 512).ensureAlpha().extract({ left: 12, top: 256, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
const hex = (n) => n.toString(16).padStart(2, "0");
const ICON_BG = data[3] < 128 ? "#0d1b2a" : `#${hex(data[0])}${hex(data[1])}${hex(data[2])}`;

// 1. The app opens the live website; www only holds the "No signal" screen shown when that can't load
fs.rmSync(path.join(here, "www"), { recursive: true, force: true });
fs.mkdirSync(path.join(here, "www"));
fs.writeFileSync(path.join(here, "www", "index.html"), fs.readFileSync(path.join(here, "offline.html"), "utf8").replaceAll("__BG__", ICON_BG));
await sharp(iconPath).resize(192, 192).png().toFile(path.join(here, "www", "icon-192.png"));

// 2. Create the Android project (fresh each time, so nothing goes stale)
fs.rmSync(path.join(here, "android"), { recursive: true, force: true });
run("npx cap add android");
fs.copyFileSync(services, path.join(here, "android", "app", "google-services.json"));

// 3. App icon: the website icon, shrunk a little so round and squircle icon shapes don't cut it off
fs.mkdirSync(path.join(here, "assets"), { recursive: true });
await sharp(iconPath).resize(1024, 1024).png().toFile(path.join(here, "assets", "icon-only.png"));
const inner = await sharp(iconPath).resize(INNER, INNER).png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: inner, left: (1024 - INNER) / 2, top: (1024 - INNER) / 2 }]).png().toFile(path.join(here, "assets", "icon-foreground.png"));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: ICON_BG } })
  .png().toFile(path.join(here, "assets", "icon-background.png"));
run(`npx capacitor-assets generate --android --iconBackgroundColor "${ICON_BG}" --splashBackgroundColor "${ICON_BG}"`);

// 3a. Small white "eye" icon for the notification bar (Android shows it as a white shape)
const eye = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="M12 5C6.5 5 2.7 9.2 1.5 12c1.2 2.8 5 7 10.5 7s9.3-4.2 10.5-7C21.3 9.2 17.5 5 12 5zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>`;
for (const [dir, px] of [["mdpi", 24], ["hdpi", 36], ["xhdpi", 48], ["xxhdpi", 72], ["xxxhdpi", 96]]) {
  const d = path.join(here, "android", "app", "src", "main", "res", `drawable-${dir}`);
  fs.mkdirSync(d, { recursive: true });
  await sharp(Buffer.from(eye)).resize(px, px).png().toFile(path.join(d, "ic_stat_watch.png"));
}

// 3b. Screen direction, extra permissions, notification icon + channel
const manifestFile = path.join(here, "android", "app", "src", "main", "AndroidManifest.xml");
let manifest = fs.readFileSync(manifestFile, "utf8");
if (ORIENTATION) {
  manifest = manifest.replace(/<activity(?=\s)/, `<activity android:screenOrientation="${ORIENTATION}"`);
  if (!manifest.includes("screenOrientation")) throw new Error("Could not set the screen direction");
}
for (const p of PERMISSIONS) {
  const line = `<uses-permission android:name="android.permission.${p}" />`;
  if (!manifest.includes(`android.permission.${p}"`)) manifest = manifest.replace("</manifest>", "    " + line + "\n</manifest>");
}
const meta = `
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_watch" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="watch" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@android:color/holo_blue_light" />
    </application>`;
manifest = manifest.replace("</application>", meta);
if (!manifest.includes("default_notification_icon")) throw new Error("Could not add the notification icon");
fs.writeFileSync(manifestFile, manifest);

// 4. Version number: must go up every release so updates install over the old app
const gradleFile = path.join(here, "android", "app", "build.gradle");
let gradle = fs.readFileSync(gradleFile, "utf8");
gradle = gradle.replace(/versionCode \d+/, `versionCode ${build}`)
               .replace(/versionName "[^"]*"/, `versionName "1.${build}"`);
fs.writeFileSync(gradleFile, gradle);

// 5. Build
const win = process.platform === "win32";
const androidDir = path.join(here, "android");
if (!win) fs.chmodSync(path.join(androidDir, "gradlew"), 0o755);
execSync(`"${path.join(androidDir, win ? "gradlew.bat" : "gradlew")}" assembleRelease`,
  { cwd: androidDir, stdio: "inherit" });

// 6. Sign (the password is passed through an environment variable, never on the command line)
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const tools = path.join(sdk, "build-tools");
const latest = fs.readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const tool = (name) => `"${path.join(tools, latest, win ? `${name}${name === "zipalign" ? ".exe" : ".bat"}` : name)}"`;
const out = path.join(here, "android", "app", "build", "outputs", "apk", "release");
const unsigned = path.join(out, "app-release-unsigned.apk");
const aligned = path.join(out, "app-release-aligned.apk");
const final = path.join(here, APK_NAME);
fs.rmSync(aligned, { force: true });
run(`${tool("zipalign")} -p -f 4 "${unsigned}" "${aligned}"`);
run(`${tool("apksigner")} sign --ks "${keystore}" --ks-key-alias release ` +
    `--ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEYSTORE_PASSWORD --out "${final}" "${aligned}"`);
run(`${tool("apksigner")} verify "${final}"`);
console.log(`\nDone: android-app/${APK_NAME} (version 1.${build})`);
