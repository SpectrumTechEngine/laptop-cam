// Laptop Cam alert server (Firebase project chopthecheck, region europe-west1).
// One small web address, three jobs:
//   op "key"   → gives phones the public notification key
//   op "sub"   → a phone signs up for alerts for one camera room
//   op "unsub" → a phone stops alerts
//   op "send"  → the laptop says "someone started watching"; every signed-up phone gets a notification
// Signed-up phones are kept in the Realtime Database under lcPush/<room>/ (only this server can read it;
// the database rules don't let apps in). The private notification key is made on first use and kept in
// lcPushKeys/ the same way, so it never sits in a file or a repo.

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const webpush = require('web-push');
const crypto = require('crypto');

admin.initializeApp({ databaseURL: 'https://chopthecheck-default-rtdb.europe-west1.firebasedatabase.app' });
const db = admin.database();

let keysP = null;
function keys() {
  if (!keysP) keysP = (async () => {
    const ref = db.ref('lcPushKeys');
    const r = await ref.transaction((cur) => cur || { ...webpush.generateVAPIDKeys(), at: Date.now() });
    const k = r.snapshot.val();
    webpush.setVapidDetails('mailto:support@thespectrumtechengine.com', k.publicKey, k.privateKey);
    return k;
  })().catch((e) => { keysP = null; throw e; });
  return keysP;
}

const isRoom = (s) => typeof s === 'string' && /^[0-9a-f]{24}$/.test(s);
const isId = (s) => typeof s === 'string' && /^[0-9a-f]{20}$/.test(s);
const text = (s, n) => String(s || '').slice(0, n);

exports.laptopCam = onRequest({ region: 'europe-west1', cors: true, maxInstances: 2, memory: '256MiB', timeoutSeconds: 30 }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = req.body || {};
  try {
    const k = await keys();
    if (b.op === 'key') return res.json({ key: k.publicKey });
    if (!isRoom(b.room)) return res.status(400).json({ error: 'room' });
    const ref = db.ref('lcPush/' + b.room);

    if (b.op === 'sub' && b.fcm) {
      // The Android app: it signs up with a Firebase Cloud Messaging token instead
      if (typeof b.fcm !== 'string' || b.fcm.length < 20 || b.fcm.length > 4096) return res.status(400).json({ error: 'fcm' });
      const all = (await ref.get()).val() || {};
      const id = crypto.createHash('sha256').update('fcm:' + b.fcm).digest('hex').slice(0, 20);
      if (!all[id] && Object.keys(all).length >= 10) return res.status(429).json({ error: 'too many phones' });
      await ref.child(id).set({ f: b.fcm, t: Date.now() });
      return res.json({ ok: true, id });
    }

    if (b.op === 'sub') {
      const s = b.sub || {};
      if (typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000 || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string' || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return res.status(400).json({ error: 'sub' });
      const all = (await ref.get()).val() || {};
      if (Object.keys(all).length >= 10) return res.status(429).json({ error: 'too many phones' });
      const id = crypto.createHash('sha256').update(s.endpoint).digest('hex').slice(0, 20);
      await ref.child(id).set({ e: s.endpoint, p: s.keys.p256dh, a: s.keys.auth, t: Date.now() });
      return res.json({ ok: true, id });
    }

    if (b.op === 'unsub') {
      if (isId(b.id)) await ref.child(b.id).remove();
      return res.json({ ok: true });
    }

    if (b.op === 'send') {
      // At most one alert every 5 seconds per camera, so nobody can flood the phones.
      const last = db.ref('lcPushLast/' + b.room);
      const now = Date.now();
      const t = await last.transaction((cur) => (cur && now - cur < 5000) ? undefined : now);
      if (!t.committed) return res.status(429).json({ error: 'slow down' });
      const title = text(b.title, 80) || 'Laptop Cam', body = text(b.body, 200);
      const msg = JSON.stringify({ title, body, tag: 'laptop-cam' });
      const subs = (await ref.get()).val() || {};
      let sent = 0;
      await Promise.all(Object.entries(subs).map(async ([id, s]) => {
        if (id === b.skip) return;
        try {
          if (s.f) {
            await admin.messaging().send({
              token: s.f,
              notification: { title, body },
              android: { priority: 'high', ttl: 3600 * 1000, notification: { channelId: 'watch', tag: 'laptop-cam', sound: 'default', defaultVibrateTimings: true } },
            });
          } else {
            await webpush.sendNotification({ endpoint: s.e, keys: { p256dh: s.p, auth: s.a } }, msg, { TTL: 3600, urgency: 'high' });
          }
          sent++;
        } catch (e) {
          const gone = e.statusCode === 404 || e.statusCode === 410 ||
            ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(e.code);
          if (gone) await ref.child(id).remove();   // phone uninstalled the app or turned alerts off
          else console.warn('send failed', e.code || e.statusCode);
        }
      }));
      return res.json({ ok: true, sent, phones: Object.keys(subs).length });
    }

    return res.status(400).json({ error: 'op' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server' });
  }
});
