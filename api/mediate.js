
const admin = require("firebase-admin");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN;

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authorization = req.headers.authorization || "";
    const idToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!idToken) {
      return res.status(401).json({ error: "Sign-in required" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const { roomCode } = req.body || {};

    if (typeof roomCode !== "string" ||
        !/^[A-Z0-9]{20,40}$/.test(roomCode)) {
      return res.status(400).json({ error: "Invalid room code" });
    }

    const roomRef = admin.database().ref(`rooms/${roomCode}`);
    const snapshot = await roomRef.get();
    const room = snapshot.val();

    if (!room || !room.participants ||
        !room.participants[uid]) {
      return res.status(403).json({ error: "You are not a member of this room" });
    }

    if (!room.personA || !room.personB) {
      return res.status(409).json({ error: "Both people must submit first" });
    }

    if (room.verdict) {
      return res.status(200).json({ verdict: room.verdict });
    }

    const lock = await roomRef.child("verdictStatus").transaction(
      current => current === "generating" || current === "complete"
        ? undefined
        : "generating"
    );

    if (!lock.committed) {
      return res.status(409).json({ error: "Mediation is already being processed" });
    }

    const systemPrompt = `You are a neutral, empathetic relationship mediator.
Treat both people fairly. Do not declare a winner or make assumptions.
If either account describes fear, coercion, threats, or abuse, do not
recommend confrontation or compromise that could put someone at risk.
Encourage support from a trusted adult or qualified professional when safety is involved.

Use these headings:
1. Core Misunderstanding
2. Blind Spots
3. Common Ground
4. Next Steps

Offer two realistic, respectful next steps.`;

    const userPrompt = `
PERSON A:
What happened: ${room.personA.happened}
How they felt: ${room.personA.felt}
Desired outcome: ${room.personA.outcome}

PERSON B:
What happened: ${room.personB.happened}
How they felt: ${room.personB.felt}
Desired outcome: ${room.personB.outcome}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(process.env.GEMINI_API_KEY),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }]
        })
      }
    );

    if (!response.ok) {
      throw new Error("Gemini request failed");
    }

    const result = await response.json();
    const verdict = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!verdict) throw new Error("Gemini returned no response");

    await roomRef.update({
      verdict,
      verdictStatus: "complete"
    });

    return res.status(200).json({ verdict });
  } catch (error) {
    return res.status(500).json({
      error: "Mediation could not be completed. Please try again."
    });
  }
};
