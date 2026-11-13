
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// PASTE YOUR FIREBASE CONFIG BELOW (Replace this whole object)
const firebaseConfig = {
  apiKey: "AIzaSyB9ZuM5GS-5ZKZVHBQRzALikkah6o1hW8M",
  authDomain: "ai-relationship-mediator-ae95e.firebaseapp.com",
  databaseURL: "https://ai-relationship-mediator-ae95e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ai-relationship-mediator-ae95e",
  storageBucket: "ai-relationship-mediator-ae95e.firebasestorage.app",
  messagingSenderId: "41520836304",
  appId: "1:41520836304:web:0b34bbe5502d556f7678d5"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const urlParams = new URLSearchParams(window.location.search);
let roomCode = urlParams.get("room");
let role = roomCode ? "personB" : "personA";

const setupScreen = document.getElementById("setup-screen");
const roomScreen = document.getElementById("room-screen");
const verdictScreen = document.getElementById("verdict-screen");
const formArea = document.getElementById("form-area");
const waitingArea = document.getElementById("waiting-area");

if (roomCode) {
enterRoom(roomCode, "personB");
}

document.getElementById("create-room-btn").addEventListener("click", () => {
const apiKey = document.getElementById("api-key").value.trim();
if (!apiKey) return alert("Please enter your Gemini API key first.");

sessionStorage.setItem("gemini_api_key", apiKey);
roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

set(ref(db, rooms/${roomCode}), {
apiKey: apiKey,
createdAt: Date.now()
});

enterRoom(roomCode, "personA");
});

function enterRoom(code, userRole) {
setupScreen.classList.add("hidden");
roomScreen.classList.remove("hidden");
document.getElementById("display-room-code").textContent = code;
document.getElementById("role-label").textContent =
userRole === "personA" ? "You are Person A (Room Creator)" : "You are Person B (Invited)";

document.getElementById("copy-link-btn").addEventListener("click", () => {
const inviteUrl = ${window.location.origin}${window.location.pathname}?room=${code};
navigator.clipboard.writeText(inviteUrl);
alert("Invite link copied! Send it to the other person.");
});

const roomRef = ref(db, rooms/${code});
onValue(roomRef, async (snapshot) => {
const data = snapshot.val();
if (!data) return;

if (data.verdict) {  
  roomScreen.classList.add("hidden");  
  verdictScreen.classList.remove("hidden");  
  document.getElementById("verdict-content").textContent = data.verdict;  
  return;  
}  

if (data.personA && data.personB && !data.verdict) {  
  roomScreen.classList.add("hidden");  
  verdictScreen.classList.remove("hidden");  

  if (userRole === "personA") {  
    const verdict = await generateVerdict(data.apiKey, data.personA, data.personB);  
    update(roomRef, { verdict });  
  }  
}

});
}

document.getElementById("submit-side-btn").addEventListener("click", () => {
const happened = document.getElementById("what-happened").value.trim();
const felt = document.getElementById("how-felt").value.trim();
const outcome = document.getElementById("desired-outcome").value.trim();

if (!happened || !felt || !outcome) {
return alert("Please fill out all three fields before submitting.");
}

update(ref(db, rooms/${roomCode}), {
[role]: { happened, felt, outcome }
});

formArea.classList.add("hidden");
waitingArea.classList.remove("hidden");
});

async function generateVerdict(apiKey, personA, personB) {
const systemPrompt = `You are a neutral, empathetic relationship mediator. Two people submitted their perspectives separately without seeing what the other wrote.
Analyze both sides objectively and respond using this exact structure:

1. Core Misunderstanding: Summarize what each person is trying to communicate beneath the frustration.
2. Blind Spots: Gently point out where each person might be missing the other's perspective, deflecting, or reacting defensively.
3. Common Ground: Highlight what both people seem to want.
4. Next Steps: Suggest 2 realistic compromises they can agree on right now.
   Keep the tone calm, fair, and constructive. Do not declare a winner.`;

const userPrompt = `
PERSON A:

- What happened: ${personA.happened}
- How they felt: ${personA.felt}
- Desired outcome: ${personA.outcome}

PERSON B:

- What happened: ${personB.happened}

- How they felt: ${personB.felt}

- Desired outcome: ${personB.outcome}
  `;

  try {
  const response = await fetch(
  https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey},
  {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
  system_instruction: { parts: [{ text: systemPrompt }] },
  contents: [{ parts: [{ text: userPrompt }] }]
  })
  }
  );

  const result = await response.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || "Could not generate response. Check your API key.";
  } catch (err) {
  return "Error connecting to Gemini API: " + err.message;
  }
  }
