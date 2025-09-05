const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

const db = admin.firestore();

const MESSAGE_LIMIT = 5;
const TIME_WINDOW = 60 * 1000;
const BAN_DURATION = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 100;
const MAX_USERNAME_LENGTH = 10;
const MAX_AVATAR_LENGTH = 100;
const HIDDEN_IP_HASH = 'a745304ef88f6607b4f4bed1ab8cef5f9df293b296b24360f723510fd70aea6a';

// Functie om IP te hashen
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Functie om HTML te escapen (XSS preventie)
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Deze functies worden nu genegeerd, maar laten we ze intact voor als je ze later weer inschakelt
async function isIpBanned(ipHash) {
  const banDoc = await db.collection('bans').doc(ipHash).get();
  if (banDoc.exists) {
    const banData = banDoc.data();
    const banExpires = banData.expiresAt.toMillis();
    if (Date.now() < banExpires) {
      return true;
    } else {
      await db.collection('bans').doc(ipHash).delete();
      return false;
    }
  }
  return false;
}

async function checkSpam(ipHash) {
  const spamRef = db.collection('spam_tracking').doc(ipHash);
  const spamDoc = await spamRef.get();
  const now = Date.now();

  if (!spamDoc.exists) {
    await spamRef.set({
      count: 1,
      firstMessageTime: admin.firestore.FieldValue.serverTimestamp(),
    });
    return false;
  }

  const spamData = spamDoc.data();
  const firstMessageTime = spamData.firstMessageTime.toMillis();
  const messageCount = spamData.count;

  if (now - firstMessageTime > TIME_WINDOW) {
    await spamRef.set({
      count: 1,
      firstMessageTime: admin.firestore.FieldValue.serverTimestamp(),
    });
    return false;
  }

  if (messageCount >= MESSAGE_LIMIT) {
    await db.collection('bans').doc(ipHash).set({
      expiresAt: admin.firestore.Timestamp.fromMillis(now + BAN_DURATION),
    });
    return true;
  }

  await spamRef.update({
    count: admin.firestore.FieldValue.increment(1),
  });
  return false;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const ipAddress = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'Onbekend').split(',')[0].trim();
  const ipHash = hashIp(ipAddress);

  if (req.method === 'GET') {
    try {
      const snapshot = await db.collection('messages').orderBy('timestamp', 'asc').get();
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        text: doc.data().text,
        username: doc.data().username || 'Anoniem',
        avatar: doc.data().avatar || '😀',
        timestamp: doc.data().timestamp ? doc.data().timestamp.toDate().toISOString() : null,
        ip: doc.data().ip || 'Niet beschikbaar',
      }));
      res.status(200).json(messages);
    } catch (error) {
      console.error('Firestore fout:', error);
      res.status(500).json({ error: 'Fout bij ophalen berichten', details: error.message });
    }
  } else if (req.method === 'POST') {
    let { text, username, avatar } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Geen tekst opgegeven' });
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Bericht te lang (max ${MAX_MESSAGE_LENGTH} tekens)` });
    }
    if (username && username.length > MAX_USERNAME_LENGTH) {
      return res.status(400).json({ error: `Naam te lang (max ${MAX_USERNAME_LENGTH} tekens)` });
    }
    if (avatar && avatar.length > MAX_AVATAR_LENGTH) {
      return res.status(400).json({ error: `Avatar te lang (max ${MAX_AVATAR_LENGTH} tekens)` });
    }

    try {
      // Alle invoer escapen (tegen XSS)
      const safeText = escapeHtml(text);
      const safeUsername = username ? escapeHtml(username) : 'Anoniem';
      const safeAvatar = avatar ? escapeHtml(avatar) : '😀';

      // Spam- en ban-tracking tijdelijk uitgeschakeld
      /*
      if (await isIpBanned(ipHash)) {
        return res.status(403).json({ error: 'Je bent tijdelijk geblokkeerd wegens spammen. Probeer het later opnieuw.' });
      }

      if (await checkSpam(ipHash)) {
        return res.status(429).json({ error: 'Te veel berichten verstuurd. Je bent nu 5 minuten geblokkeerd.' });
      }
      */

      const ipToStore = ipHash === HIDDEN_IP_HASH ? 'Verborgen' : ipAddress;

      const newMessage = {
        text: safeText,
        username: safeUsername,
        avatar: safeAvatar,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: ipToStore,
      };
      await db.collection('messages').add(newMessage);
      res.status(200).json({ message: 'Bericht verzonden' });
    } catch (error) {
      console.error('Firestore fout:', error);
      res.status(500).json({ error: 'Fout bij verzenden bericht', details: error.message });
    }
  } else {
    res.status(405).json({ error: 'Methode niet toegestaan' });
  }
};
