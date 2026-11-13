JavaScript

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// 1. Vercel backend
const API_BASE_URL =
  "https://ai-relationship-mediator-ga7mdibff-gt-gng.vercel.app";

// 2. Firebase configuration
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
const auth = getAuth(app);

let currentUser = null;
let roomCode = null;
let role = null;
let pollTimer = null;
let checkingStatus = false;
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

async function apiRequest(action, extra = {}) {
  const token = await currentUser.getIdToken();

  const response = await fetch(`${API_BASE_URL}/api/mediate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      action,
      roomCode,
      ...extra
    })
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error || "The request could not be completed."
    );
    error.status = response.status;
    throw error;
  }

  return result;
}

async function createRoom() {
  try {
    showError("");
    createButton.disabled = true;

    const result = await apiRequest("create");

    roomCode = result.roomCode;
    role = result.role;

    history.replaceState(null, "", `?room=${roomCode}`);

    showRoom(roomCode, role);
    startPolling();

  } catch (error) {
    showError(error.message);
  } finally {
    createButton.disabled = false;
  }
}

async function joinRoom(code) {
  try {
    showError("");

    if (!/^[A-F0-9]{32}$/.test(code)) {
      throw new Error("Invalid invitation link.");
    }

    roomCode = code;

    const result = await apiRequest("join");

    role = result.role;

    showRoom(roomCode, role);
    startPolling();

  } catch (error) {
    roomCode = null;
    role = null;
    showError(error.message);
  }
}

async function submitSide() {
  try {
    showError("");

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
      throw new Error("Please shorten your answers.");
    }

    submitButton.disabled = true;

    await apiRequest("submit", {
      submission: {
        happened,
        felt,
        outcome
      }
    });

    formArea.classList.add("hidden");
    waitingArea.classList.remove("hidden");

    startPolling();

  } catch (error) {
    showError(error.message);
  } finally {
    submitButton.disabled = false;
  }
}

function showVerdict(verdict) {
  if (!verdict) return;

  stopPolling();

  document.getElementById("verdict-content").textContent = verdict;

  roomScreen.classList.add("hidden");
  verdictScreen.classList.remove("hidden");
}

async function checkStatus() {
  if (!roomCode || checkingStatus) return;

  checkingStatus = true;

  try {
    const result = await apiRequest("status");

    if (result.verdict) {
      showVerdict(result.verdict);
      return;
    }

    if (result.submitted) {
      formArea.classList.add("hidden");
      waitingArea.classList.remove("hidden");
    }

    if (
      result.bothSubmitted &&
      role === "personA" &&
      !generating
    ) {
      generating = true;

      try {
        const mediation = await apiRequest("mediate");

        if (mediation.verdict) {
          showVerdict(mediation.verdict);
        }
      } catch (error) {
        if (error.status !== 409) {
          showError("Mediation could not be completed. Please try again.");
        }
      } finally {
        generating = false;
      }
    }

  } catch (error) {
    showError("Connection issue. Retrying...");
  } finally {
    checkingStatus = false;
  }
}

function startPolling() {
  stopPolling();
  checkStatus();

  pollTimer = window.setInterval(checkStatus, 3000);
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

copyButton.addEventListener("click", async () => {
  try {
    const inviteUrl =
      `${window.location.origin}${window.location.pathname}?room=${roomCode}`;

    await navigator.clipboard.writeText(inviteUrl);
    showError("Invite link copied!");
  } catch (error) {
    showError("Could not copy the invitation link.");
  }
});

createButton.addEventListener("click", createRoom);
submitButton.addEventListener("click", submitSide);

newSessionButton.addEventListener("click", () => {
  stopPolling();
  window.location.href = window.location.pathname;
});

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
    showError("Could not connect. Please refresh and try again.");
    console.error(error);
  }
}

startApp();
