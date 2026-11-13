
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "ai-relationship-mediator-ae95e.firebaseapp.com",
  databaseURL: "https://ai-relationship-mediator-ae95e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ai-relationship-mediator-ae95e",
  storageBucket: "ai-relationship-mediator-ae95e.firebasestorage.app",
  messagingSenderId: "41520836304",
  appId: "1:41520836304:web:0b34bbe5502d556f7678d5"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

let currentUser = null;
let roomCode = null;
let role = null;
let generating = false;

const setupScreen = document.getElementById("setup-screen");
const roomScreen = document.getElementById("room-screen");
const verdictScreen = document.getElementById("verdict-screen");
const formArea = document.getElementById("form-area");
const waitingArea = document.getElementById("waiting-area");

const createButton = document.getElementById("create-room-btn");
const submitButton = document.getElementById("submit-side-btn");
const copyButton = document.getElementById("copy-link-btn");
const newSessionButton = document.getElementById("new-session-btn");

const errorMessage = document.getElementById("error-message");

function showError(message) {
  errorMessage.textContent = message;
}

function showRoom(code, userRole) {
  setupScreen.classList.add("hidden");
  verdictScreen.classList.add("hidden");
  roomScreen.classList.remove("hidden");

  document.getElementById("display-room-code").textContent = code;

  document.getElementById("role-label").textContent =
    userRole === "personA"
      ? "You are Person A (Room Creator)"
      : "You are Person B (Invited)";
}

function createRoomCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function startApp() {
  try {
    const result = await signInAnonymously(auth);
    currentUser = result.user;

    const params = new URLSearchParams(window.location.search);
    const invitedRoom = params.get("room");

    if (invitedRoom) {
      await joinRoom(invitedRoom.toUpperCase());
    }
  } catch (error) {
    showError("Could not sign in. Please refresh and try again.");
    console.error(error);
  }
}

async function createRoom() {
  try {
    showError("");

    if (!currentUser) {
      throw new Error("Authentication is not ready.");
    }

    createButton.disabled = true;

    roomCode = createRoomCode();
    role = "personA";

    await set(ref(db, `rooms/${roomCode}`), {
      participants: {
        [currentUser.uid]: "personA"
      },
      createdAt: Date.now(),
      status: "open"
    });

    history.replaceState(null, "", `?room=${roomCode}`);
    showRoom(roomCode, role);
    listenToRoom();
  } catch (error) {
    showError("Could not create room. Please try again.");
    console.error(error);
  } finally {
    createButton.disabled = false;
  }
}

async function joinRoom(code) {
  try {
    showError("");

    if (!/^[A-F0-9]{32}$/.test(code)) {
      throw new Error("Invalid room code.");
    }

    const roomRef = ref(db, `rooms/${code}`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
      throw new Error("This room does not exist.");
    }

    const result = await runTransaction(
      ref(db, `rooms/${code}/participants`),
      current => {
        current = current || {};

        if (current[currentUser.uid]) {
          return current;
        }

        if (Object.keys(current).length >= 2) {
          return;
        }

        return {
          ...current,
          [currentUser.uid]: "personB"
        };
      }
    );

    if (!result.committed) {
      throw new Error("This room is already full.");
    }

    const participants = result.snapshot.val();
    role = participants[currentUser.uid];

    if (role !== "personA" && role !== "personB") {
      throw new Error("Could not identify your room role.");
    }

    roomCode = code;
    showRoom(code, role);
    listenToRoom();
  } catch (error) {
    showError(error.message || "Could not join this room.");
    console.error(error);
  }
}

function listenToRoom() {
  const roomRef = ref(db, `rooms/${roomCode}`);

  onValue(roomRef, async snapshot => {
    const data = snapshot.val();

    if (!data) {
      showError("This room is no longer available.");
      return;
    }

    if (data.verdict) {
      roomScreen.classList.add("hidden");
      verdictScreen.classList.remove("hidden");

      document.getElementById("verdict-content").textContent =
        data.verdict;

      return;
    }

    const mySubmission = data[role];

    if (mySubmission) {
      formArea.classList.add("hidden");
      waitingArea.classList.remove("hidden");
    }

    if (
      data.personA &&
      data.personB &&
      role === "personA" &&
      !generating
    ) {
      generating = true;
      await requestMediation();
    }
  });
}

async function requestMediation() {
  try {
    const idToken = await currentUser.getIdToken();

    const response = await fetch("/api/mediate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({ roomCode })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Mediation request failed.");
    }

    if (result.verdict) {
      document.getElementById("verdict-content").textContent =
        result.verdict;

      roomScreen.classList.add("hidden");
      verdictScreen.classList.remove("hidden");
    }
  } catch (error) {
    generating = false;
    showError(
      "Mediation could not be completed. Please try again later."
    );
    console.error(error);
  }
}

async function submitSide() {
  try {
    showError("");

    if (!roomCode || !role || !currentUser) {
      throw new Error("Room connection is not ready.");
    }

    const happened =
      document.getElementById("what-happened").value.trim();

    const felt =
      document.getElementById("how-felt").value.trim();

    const outcome =
      document.getElementById("desired-outcome").value.trim();

    if (!happened || !felt || !outcome) {
      throw new Error("Please complete all three fields.");
    }

    if (
      happened.length > 2000 ||
      felt.length > 1000 ||
      outcome.length > 1000
    ) {
      throw new Error("Please shorten your answers before submitting.");
    }

    submitButton.disabled = true;

    await set(
      ref(db, `rooms/${roomCode}/${role}`),
      {
        happened,
        felt,
        outcome,
        submittedAt: Date.now()
      }
    );

    formArea.classList.add("hidden");
    waitingArea.classList.remove("hidden");
  } catch (error) {
    showError(error.message || "Submission failed.");
    console.error(error);
  } finally {
    submitButton.disabled = false;
  }
}

copyButton.addEventListener("click", async () => {
  try {
    const inviteUrl =
      `${window.location.origin}${window.location.pathname}?room=${roomCode}`;

    await navigator.clipboard.writeText(inviteUrl);
    alert("Invite link copied!");
  } catch (error) {
    showError("Could not copy the invite link.");
  }
});

createButton.addEventListener("click", createRoom);
submitButton.addEventListener("click", submitSide);

newSessionButton.addEventListener("click", () => {
  window.location.href = window.location.pathname;
});

startApp();
