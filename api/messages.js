const admin = require('firebase-admin');


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

async function isIpBanned(ip) {
  const banDoc = await db.collection('bans').doc(ip).get();
  if (banDoc.exists) {
    const banData = banDoc.data();
    const banExpires = banData.expiresAt.toMillis();
    if (Date.now() < banExpires) {
      return true;
    } else {
      await db.collection('bans').doc(ip).delete();
      return false;
    }
  }
  return false;
}

async function checkSpam(ip) {
  const spamRef = db.collection('spam_tracking').doc(ip);
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
    await db.collection('bans').doc(ip).set({
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

  if (req.method === 'GET') {
    try {
      const snapshot = await db.collection('messages').orderBy('timestamp', 'asc').get();
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        text: doc.data().text,
        username: doc.data().username || 'Anoniem',
        timestamp: doc.data().timestamp ? doc.data().timestamp.toDate().toISOString() : null,
        ip: doc.data().ip || 'Niet beschikbaar',
      }));
      res.status(200).json(messages);
    } catch (error) {
      console.error('Firestore fout:', error);
      res.status(500).json({ error: 'Fout bij ophalen berichten', details: error.message });
    }
  }
  else if (req.method === 'POST') {
    const { text, username } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Geen tekst opgegeven' });
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: 'Bericht te lang (max ${MAX_MESSAGE_LENGTH} tekens' });
    }

    try {
      if (await isIpBanned(ipAddress)) {
        return res.status(403).json({ error: 'Je bent tijdelijk geblokkeerd wegens spammen. Probeer het later opnieuw.' });
      }

      if (await checkSpam(ipAddress)) {
        return res.status(429).json({ error: 'Te veel berichten verstuurd. Je bent nu 5 minuten geblokkeerd.' });
      }

      const newMessage = {
        text,
        username: username || 'Anoniem',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: ipAddress,
      };
      await db.collection('messages').add(newMessage);
      res.status(200).json({ message: 'Bericht verzonden' });
    } catch (error) {
      console.error('Firestore fout:', error);
      res.status(500).json({ error: 'Fout bij verzenden bericht', details: error.message });
    }
  }
  else {
    res.status(405).json({ error: 'Methode niet toegestaan' });
  }
};
