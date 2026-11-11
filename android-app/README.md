# Android app

This folder turns Laptop Cam into an Android APK. You don't need to touch it.

- The app opens the live website at thespectrumtechengine.com/laptop-cam/, so changes
  you push to the website show up in the app straight away.
- Unlike the website, the app gets real Android notifications (Firebase Cloud Messaging)
  when someone starts watching. `google-services.json` connects it to the chopthecheck
  Firebase project (it holds no secrets; the same details are in the web page).
- With no signal it shows a "No signal" screen (`offline.html`).
- Every push to `main` runs `.github/workflows/android-apk.yml`, which builds a
  signed APK and publishes it as a GitHub Release. The newest APK is always at:
  https://github.com/SpectrumTechEngine/laptop-cam/releases/latest/download/laptop-cam.apk

The signing key is NOT in this repo. It lives in GitHub secrets
(ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD) and in your backed-up
keys folder (laptop-cam.jks).
