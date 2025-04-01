const admin = require('firebase-admin');

// Initialiseer Firebase Admin
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

module.exports = async (req, res) => {
  // Stel CORS-headers in voor alle verzoeken
  res.setHeader('Access-Control-Allow-Origin', '*'); // Of specificeer 'https://chat.daan.engineer'
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handel preflight OPTIONS-verzoek af
  if (req.method === 'OPTIONS') {
    res.status(200).end(); // Stuur een lege 200 OK response
    return;
  }

  // GET: Haal berichten op
  if (req.method === 'GET') {
    try {
      const snapshot = await db.collection('messages').orderBy('timestamp').get();
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      res.status(200).json(messages);
    } catch (error) {
      console.error('Firestore fout:', error);
      res.status(500).json({ error: 'Fout bij ophalen berichten', details: error.message });
    }
  }
  // POST: Verstuur een bericht
  else if (req.method === 'POST') {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Geen tekst opgegeven' });
    }
    try {
      const newMessage = {
        text,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };
      await db.collection('messages').add(newMessage);
      res.status(200).json({ message: 'Bericht verzonden' });
    } catch (error) {
      console.error('Firestore fout:', error);
      res.status(500).json({ error: 'Fout bij verzenden bericht', details: error.message });
    }
  }
  // Andere methodes
  else {
    res.status(405).json({ error: 'Methode niet toegestaan' });
  }
};