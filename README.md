# Laptop Cam

Watch a laptop's camera live from a phone, protected by a password. Part of The Spectrum Tech Engine.

- The laptop opens the page as the camera; phones tap **Live view** and enter the password.
- Video goes straight between the devices (WebRTC). They find each other through an encrypted room in a Firebase Realtime Database; the password is the key, so nobody without it can watch.
- Optional phone alerts through the free ntfy app when someone starts watching.
