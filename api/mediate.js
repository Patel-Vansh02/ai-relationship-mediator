
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

const db = admin.database();

const SYSTEM_PROMPT = `
You are a neutral, empathetic communication assistant.

Treat both participants fairly. Do not declare a winner,
make assumptions, diagnose anyone, or take sides.

Identify:
1. Core Misunderstanding
2. Each Person's Perspective
3. Common Ground
4. Respectful Next Steps

Offer practical, non-coercive communication suggestions.

If either person describes threats, fear, coercion, or abuse,
prioritize personal safety. Do not recommend confrontation
or compromise that could put someone at risk. Encourage
support from a trusted adult or qualified professional.

Do not claim to determine who is objectively right.
`;

function send(res, status, body) {
  return res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN;
  const origin = req.headers.origin;

  if (allowedOrigin && origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed" });
  }

  if (allowedOrigin && origin !== allowedOrigin) {
    return send(res, 403, { error: "Origin not allowed" });
  }

  try {
    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return send(res, 401, { error: "Sign-in required" });
    }

    const token = authorization.slice(7);
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    const body = req.body || {};
    const action = body.action;

    // CREATE ROOM
    if (action === "create") {
      const roomCode = require("crypto")
        .randomBytes(16)
        .toString("hex")
        .toUpperCase();

      await db.ref(`rooms/${roomCode}`).set({
        personAUid: uid,
        personBUid: null,
        personA: null,
        personB: null,
        verdict: null,
        createdAt: Date.now(),
        status: "open"
      });

      return send(res, 200, {
        roomCode,
        role: "personA"
      });
    }

    const roomCode = body.roomCode;

    if (
      typeof roomCode !== "string" ||
      !/^[A-F0-9]{32}$/.test(roomCode)
    ) {
      return send(res, 400, { error: "Invalid room code" });
    }

    const roomRef = db.ref(`rooms/${roomCode}`);

    // JOIN ROOM
    if (action === "join") {
      const result = await roomRef.transaction(room => {
        if (!room || room.personAUid === uid) {
          return;
        }

        if (room.personBUid && room.personBUid !== uid) {
          return;
        }

        room.personBUid = uid;
        return room;
      });

      if (!result.committed) {
        return send(res, 409, {
          error: "Room unavailable or already full"
        });
      }

      return send(res, 200, {
        roomCode,
        role: "personB"
      });
    }

    // CHECK ROOM ACCESS
    const snapshot = await roomRef.get();
    const room = snapshot.val();

    if (!room) {
      return send(res, 404, { error: "Room not found" });
    }

    let role = null;

    if (room.personAUid === uid) role = "personA";
    if (room.personBUid === uid) role = "personB";

    if (!role) {
      return send(res, 403, { error: "Not a room participant" });
    }

    // SUBMIT PERSPECTIVE
    if (action === "submit") {
      const { happened, felt, outcome } = body.submission || {};

      if (
        typeof happened !== "string" ||
        typeof felt !== "string" ||
        typeof outcome !== "string" ||
        !happened.trim() ||
        !felt.trim() ||
        !outcome.trim() ||
        happened.length > 2000 ||
        felt.length > 1000 ||
        outcome.length > 1000
      ) {
        return send(res, 400, {
          error: "Please provide valid answers"
        });
      }

      const submissionRef = roomRef.child(role);

      const result = await submissionRef.transaction(current => {
        if (current) return;
        return {
          happened: happened.trim(),
          felt: felt.trim(),
          outcome: outcome.trim(),
          submittedAt: Date.now()
        };
      });

      if (!result.committed) {
        return send(res, 409, {
          error: "Your submission has already been saved"
        });
      }

      return send(res, 200, { saved: true });
    }

    // CHECK STATUS
    if (action === "status") {
      return send(res, 200, {
        role,
        submitted: Boolean(room[role]),
        bothSubmitted: Boolean(room.personA && room.personB),
        verdict: room.verdict || null
      });
    }

    // GENERATE MEDIATION
    if (action === "mediate") {
      if (!room.personA || !room.personB) {
        return send(res, 409, {
          error: "Both participants must submit first"
        });
      }

      if (room.verdict) {
        return send(res, 200, { verdict: room.verdict });
      }

      const lock = await roomRef.child("verdictStatus").transaction(
        current => {
          if (current === "generating" || current === "complete") {
            return;
          }
          return "generating";
        }
      );

      if (!lock.committed) {
        return send(res, 409, {
          error: "Mediation is already being processed"
        });
      }

      try {
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
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: SYSTEM_PROMPT }]
              },
              contents: [{
                parts: [{ text: userPrompt }]
              }]
            })
          }
        );

        if (!response.ok) {
          throw new Error("AI request failed");
        }

        const result = await response.json();

        const verdict =
          result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!verdict) {
          throw new Error("AI response was empty");
        }

        await roomRef.update({
          verdict,
          verdictStatus: "complete"
        });

        return send(res, 200, { verdict });

      } catch (error) {
        await roomRef.child("verdictStatus").set("failed");

        throw error;
      }
    }

    return send(res, 400, { error: "Unknown action" });

  } catch (error) {
    console.error("Mediator API error:", error.message);

    return send(res, 500, {
      error: "Request could not be completed. Please try again."
    });
  }
};
