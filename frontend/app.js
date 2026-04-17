const state = {
  user: null,
  players: [],
  challenges: [],
  matches: [],
  settings: { kFactor: 32, defaultLanguage: "JavaScript" },
  activeTab: "overview",
  battle: {
    playerAId: "",
    playerBId: "",
    challengeId: "custom",
    customTitle: "",
    customPrompt: "",
    language: "JavaScript",
    codeA: `function solve(input) {
  return input;
}`,
    codeB: `function solve(input) {
  return input;
}`,
    notes: "",
  },
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  boot();
});

function cacheElements() {
  [
    "messageBox", "healthBox", "authScreen", "appScreen", "registerForm", "loginForm", "logoutBtn",
    "registerUsername", "registerPassword", "loginUsername", "loginPassword",
    "sessionUser", "playersStat", "battlesStat", "topPlayerStat", "kFactorStat",
    "leaderboard", "playerASelect", "playerBSelect", "challengeSelect", "languageSelect",
    "customChallengeBox", "customChallengeTitle", "customChallengePrompt", "challengePreview",
    "eloPreview", "playerALabel", "playerBLabel", "codeA", "codeB", "judgeNotes",
    "playerAWinBtn", "drawBtn", "playerBWinBtn", "playerForm", "challengeForm",
    "newPlayerName", "newChallengeTitle", "newChallengeDifficulty", "newChallengePrompt",
    "playersList", "challengesList", "historyList", "settingsForm", "kFactorInput",
    "defaultLanguageInput"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
  els.tabs = Array.from(document.querySelectorAll(".tab"));
  els.panels = Array.from(document.querySelectorAll(".tab-panel"));
}

function bindEvents() {
  els.registerForm.addEventListener("submit", onRegister);
  els.loginForm.addEventListener("submit", onLogin);
  els.logoutBtn.addEventListener("click", onLogout);
  els.playerForm.addEventListener("submit", onCreatePlayer);
  els.challengeForm.addEventListener("submit", onCreateChallenge);
  els.settingsForm.addEventListener("submit", onSaveSettings);

  els.playerASelect.addEventListener("change", () => {
    state.battle.playerAId = els.playerASelect.value;
    renderArenaDetails();
  });
  els.playerBSelect.addEventListener("change", () => {
    state.battle.playerBId = els.playerBSelect.value;
    renderArenaDetails();
  });
  els.challengeSelect.addEventListener("change", () => {
    state.battle.challengeId = els.challengeSelect.value;
    renderArenaDetails();
  });
  els.languageSelect.addEventListener("change", () => {
    state.battle.language = els.languageSelect.value;
  });
  els.customChallengeTitle.addEventListener("input", () => {
    state.battle.customTitle = els.customChallengeTitle.value;
    renderChallengePreview();
  });
  els.customChallengePrompt.addEventListener("input", () => {
    state.battle.customPrompt = els.customChallengePrompt.value;
    renderChallengePreview();
  });
  els.codeA.addEventListener("input", () => { state.battle.codeA = els.codeA.value; });
  els.codeB.addEventListener("input", () => { state.battle.codeB = els.codeB.value; });
  els.judgeNotes.addEventListener("input", () => { state.battle.notes = els.judgeNotes.value; });

  els.playerAWinBtn.addEventListener("click", () => onCreateMatch("A"));
  els.drawBtn.addEventListener("click", () => onCreateMatch("DRAW"));
  els.playerBWinBtn.addEventListener("click", () => onCreateMatch("B"));

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setActiveTab(tab.dataset.tab));
  });
}

async function boot() {
  await checkHealth();
  const session = await api("/api/auth/session", { allow401: true });
  if (session.authenticated) {
    state.user = session.user;
    await loadArena();
    showApp();
  } else {
    showAuth();
  }
}

async function checkHealth() {
  try {
    const result = await api("/api/health", { allow401: true });
    els.healthBox.textContent = result.ok ? "Server is running." : "Server responded unexpectedly.";
  } catch {
    els.healthBox.textContent = "Server is not reachable. Start the backend first.";
  }
}

function setMessage(text, tone = "good") {
  if (!text) {
    els.messageBox.className = "message hidden";
    els.messageBox.textContent = "";
    return;
  }
  els.messageBox.className = `message ${tone}`;
  els.messageBox.textContent = text;
}

async function api(path, options = {}) {
  const { method = "GET", body, allow401 = false } = options;
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });

  let data = null;
  const isJson = response.headers.get("content-type")?.includes("application/json");
  if (isJson) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = text ? { error: text } : null;
  }

  if (!response.ok) {
    if (allow401 && response.status === 401) {
      return data || { authenticated: false };
    }
    throw new Error(data?.error || `Request failed with ${response.status}`);
  }
  return data;
}

async function onRegister(event) {
  event.preventDefault();
  try {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: {
        username: els.registerUsername.value.trim(),
        password: els.registerPassword.value,
      },
    });
    state.user = result.user;
    await loadArena();
    showApp();
    setMessage("Account created.");
    els.registerForm.reset();
  } catch (error) {
    setMessage(error.message, "bad");
  }
}

async function onLogin(event) {
  event.preventDefault();
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: {
        username: els.loginUsername.value.trim(),
        password: els.loginPassword.value,
      },
    });
    state.user = result.user;
    await loadArena();
    showApp();
    setMessage("Logged in.");
    els.loginForm.reset();
  } catch (error) {
    setMessage(error.message, "bad");
  }
}

async function onLogout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    state.players = [];
    state.challenges = [];
    state.matches = [];
    showAuth();
    setMessage("Logged out.");
  } catch (error) {
    setMessage(error.message, "bad");
  }
}

function showAuth() {
  els.authScreen.classList.remove("hidden");
  els.appScreen.classList.add("hidden");
}

function showApp() {
  els.authScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
  renderAll();
}

async function loadArena() {
  const data = await api("/api/bootstrap");
  state.players = data.players || [];
  state.challenges = data.challenges || [];
  state.matches = data.matches || [];
  state.settings = data.settings || { kFactor: 32, defaultLanguage: "JavaScript" };
  ensureBattleDefaults();
  renderAll();
}

function ensureBattleDefaults() {
  if (!state.players.length) {
    state.battle.playerAId = "";
    state.battle.playerBId = "";
  } else {
    if (!state.players.some((p) => p.id === state.battle.playerAId)) {
      state.battle.playerAId = state.players[0]?.id || "";
    }
    if (!state.players.some((p) => p.id === state.battle.playerBId) || state.battle.playerBId === state.battle.playerAId) {
      state.battle.playerBId = state.players[1]?.id || state.players[0]?.id || "";
    }
  }

  if (!state.challenges.some((c) => c.id === state.battle.challengeId)) {
    state.battle.challengeId = state.challenges[0]?.id || "custom";
  }
  if (!state.battle.language) {
    state.battle.language = state.settings.defaultLanguage || "JavaScript";
  }
}

function setActiveTab(tab) {
  state.activeTab = tab;
  els.tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  els.panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tab}`);
  });
}

function renderAll() {
  renderHeader();
  renderOverview();
  renderManage();
  renderHistory();
  renderSettings();
  renderArenaControls();
  renderArenaDetails();
}

function renderHeader() {
  els.sessionUser.textContent = state.user ? state.user.username : "Not signed in";
  const sorted = sortedPlayers();
  const top = sorted[0];
  els.playersStat.textContent = String(state.players.length);
  els.battlesStat.textContent = String(state.matches.length);
  els.topPlayerStat.textContent = top ? `${top.name} · ${top.rating}` : "-";
  els.kFactorStat.textContent = String(state.settings.kFactor || 32);
}

function sortedPlayers() {
  return [...state.players].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name);
  });
}

function renderOverview() {
  const html = sortedPlayers().map((player, index) => `
    <div class="leader-row">
      <div class="row-head">
        <strong>#${index + 1} ${escapeHtml(player.name)}</strong>
        <span>${player.rating} Elo</span>
      </div>
      <div class="muted">${player.wins}W · ${player.losses}L · ${player.draws}D</div>
    </div>
  `).join("");
  els.leaderboard.innerHTML = html || `<div class="prompt-box">No players yet.</div>`;
}

function renderManage() {
  els.playersList.innerHTML = state.players.map((player) => {
    const hasMatches = state.matches.some((match) => match.playerAId === player.id || match.playerBId === player.id);
    return `
      <div class="player-row">
        <div class="row-head">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.rating} Elo</span>
        </div>
        <div class="muted">${player.wins}W / ${player.losses}L / ${player.draws}D</div>
        <div class="row-actions">
          <button data-delete-player="${player.id}" ${hasMatches ? "disabled" : ""}>${hasMatches ? "Has match history" : "Remove"}</button>
        </div>
      </div>
    `;
  }).join("") || `<div class="prompt-box">No players yet.</div>`;

  els.playersList.querySelectorAll("[data-delete-player]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/players/${button.dataset.deletePlayer}`, { method: "DELETE" });
        await loadArena();
        setMessage("Player removed.");
      } catch (error) {
        setMessage(error.message, "bad");
      }
    });
  });

  els.challengesList.innerHTML = state.challenges.map((challenge) => `
    <div class="challenge-row">
      <div class="row-head">
        <strong>${escapeHtml(challenge.title)}</strong>
        <span>${escapeHtml(challenge.difficulty)}</span>
      </div>
      <div class="muted">${escapeHtml(challenge.prompt)}</div>
    </div>
  `).join("") || `<div class="prompt-box">No challenges yet.</div>`;
}

function renderHistory() {
  els.historyList.innerHTML = state.matches.map((match) => {
    const resultLabel = match.result === "DRAW" ? "Draw" : match.result === "A" ? `${match.playerAName || lookupPlayerName(match.playerAId)} won` : `${match.playerBName || lookupPlayerName(match.playerBId)} won`;
    return `
      <div class="history-item">
        <div class="row-head">
          <strong>${escapeHtml(match.challengeTitle)}</strong>
          <span>${escapeHtml(resultLabel)}</span>
        </div>
        <div class="muted">${formatDate(match.createdAt)} · ${escapeHtml(match.language)}</div>
        <div>${escapeHtml(match.challengePrompt)}</div>
        <div class="preview-grid">
          <div class="preview-box">
            <div class="row-head">
              <strong>${escapeHtml(lookupPlayerName(match.playerAId))}</strong>
              <span class="badge ${badgeTone(match.deltaA)}">${signed(match.deltaA)}</span>
            </div>
            <div class="muted">${match.ratingBeforeA} → ${match.ratingAfterA}</div>
            <pre class="code-block">${escapeHtml(match.codeA)}</pre>
          </div>
          <div class="preview-box">
            <div class="row-head">
              <strong>${escapeHtml(lookupPlayerName(match.playerBId))}</strong>
              <span class="badge ${badgeTone(match.deltaB)}">${signed(match.deltaB)}</span>
            </div>
            <div class="muted">${match.ratingBeforeB} → ${match.ratingAfterB}</div>
            <pre class="code-block">${escapeHtml(match.codeB)}</pre>
          </div>
          <div class="preview-box">
            <div><strong>Expected</strong></div>
            <div class="muted">A ${Math.round(match.expectedA * 100)}% · B ${Math.round(match.expectedB * 100)}%</div>
            <div class="top-gap"><strong>Notes</strong></div>
            <div>${escapeHtml(match.notes || "-")}</div>
          </div>
        </div>
      </div>
    `;
  }).join("") || `<div class="prompt-box">No matches yet.</div>`;
}

function renderSettings() {
  els.kFactorInput.value = String(state.settings.kFactor || 32);
  els.defaultLanguageInput.value = state.settings.defaultLanguage || "JavaScript";
}

function renderArenaControls() {
  fillPlayerSelect(els.playerASelect, state.battle.playerAId);
  fillPlayerSelect(els.playerBSelect, state.battle.playerBId);

  const challengeOptions = state.challenges.map((challenge) => `
    <option value="${challenge.id}" ${state.battle.challengeId === challenge.id ? "selected" : ""}>
      ${escapeHtml(challenge.title)} · ${escapeHtml(challenge.difficulty)}
    </option>
  `).join("");
  els.challengeSelect.innerHTML = challengeOptions + `<option value="custom" ${state.battle.challengeId === "custom" ? "selected" : ""}>Custom challenge</option>`;

  els.languageSelect.value = state.battle.language || state.settings.defaultLanguage || "JavaScript";
  els.customChallengeTitle.value = state.battle.customTitle || "";
  els.customChallengePrompt.value = state.battle.customPrompt || "";
  els.codeA.value = state.battle.codeA;
  els.codeB.value = state.battle.codeB;
  els.judgeNotes.value = state.battle.notes;
}

function renderArenaDetails() {
  const playerA = state.players.find((player) => player.id === state.battle.playerAId);
  const playerB = state.players.find((player) => player.id === state.battle.playerBId);
  els.playerALabel.textContent = playerA ? playerA.name : "Player A";
  els.playerBLabel.textContent = playerB ? playerB.name : "Player B";

  els.customChallengeBox.classList.toggle("hidden", state.battle.challengeId !== "custom");
  renderChallengePreview();
  renderEloPreview(playerA, playerB);

  const invalid = !playerA || !playerB || playerA.id === playerB.id;
  els.playerAWinBtn.disabled = invalid;
  els.playerBWinBtn.disabled = invalid;
  els.drawBtn.disabled = invalid;
}

function renderChallengePreview() {
  if (state.battle.challengeId === "custom") {
    const title = state.battle.customTitle || "Custom challenge";
    const prompt = state.battle.customPrompt || "Write the prompt for this duel.";
    els.challengePreview.textContent = `${title}: ${prompt}`;
    return;
  }
  const challenge = state.challenges.find((item) => item.id === state.battle.challengeId);
  els.challengePreview.textContent = challenge ? `${challenge.title}: ${challenge.prompt}` : "No challenge selected.";
}

function renderEloPreview(playerA, playerB) {
  if (!playerA || !playerB || playerA.id === playerB.id) {
    els.eloPreview.innerHTML = `<div class="prompt-box">Pick two different players to preview Elo changes.</div>`;
    return;
  }

  const kFactor = Number(state.settings.kFactor || 32);
  const winA = calculateElo(playerA.rating, playerB.rating, 1, kFactor);
  const draw = calculateElo(playerA.rating, playerB.rating, 0.5, kFactor);
  const winB = calculateElo(playerA.rating, playerB.rating, 0, kFactor);

  els.eloPreview.innerHTML = `
    <div class="prompt-box">Expected: ${escapeHtml(playerA.name)} ${Math.round(winA.expectedA * 100)}% · ${escapeHtml(playerB.name)} ${Math.round(winA.expectedB * 100)}%</div>
    <div class="preview-grid">
      <div class="preview-box">
        <strong>If ${escapeHtml(playerA.name)} wins</strong>
        <div class="muted">${playerA.rating} → ${winA.newA} (${signed(winA.deltaA)})</div>
        <div class="muted">${playerB.rating} → ${winA.newB} (${signed(winA.deltaB)})</div>
      </div>
      <div class="preview-box">
        <strong>If draw</strong>
        <div class="muted">${playerA.rating} → ${draw.newA} (${signed(draw.deltaA)})</div>
        <div class="muted">${playerB.rating} → ${draw.newB} (${signed(draw.deltaB)})</div>
      </div>
      <div class="preview-box">
        <strong>If ${escapeHtml(playerB.name)} wins</strong>
        <div class="muted">${playerA.rating} → ${winB.newA} (${signed(winB.deltaA)})</div>
        <div class="muted">${playerB.rating} → ${winB.newB} (${signed(winB.deltaB)})</div>
      </div>
    </div>
  `;
}

function fillPlayerSelect(selectEl, selectedId) {
  const options = state.players.map((player) => `
    <option value="${player.id}" ${player.id === selectedId ? "selected" : ""}>${escapeHtml(player.name)} · ${player.rating}</option>
  `).join("");
  selectEl.innerHTML = `<option value="">Choose player</option>${options}`;
}

async function onCreatePlayer(event) {
  event.preventDefault();
  try {
    await api("/api/players", {
      method: "POST",
      body: { name: els.newPlayerName.value.trim() },
    });
    els.playerForm.reset();
    await loadArena();
    setMessage("Player added.");
  } catch (error) {
    setMessage(error.message, "bad");
  }
}

async function onCreateChallenge(event) {
  event.preventDefault();
  try {
    await api("/api/challenges", {
      method: "POST",
      body: {
        title: els.newChallengeTitle.value.trim(),
        difficulty: els.newChallengeDifficulty.value,
        prompt: els.newChallengePrompt.value.trim(),
      },
    });
    els.challengeForm.reset();
    els.newChallengeDifficulty.value = "Medium";
    await loadArena();
    setMessage("Challenge added.");
  } catch (error) {
    setMessage(error.message, "bad");
  }
}

async function onSaveSettings(event) {
  event.preventDefault();
  try {
    await api("/api/settings", {
      method: "PUT",
      body: {
        kFactor: Number(els.kFactorInput.value),
        defaultLanguage: els.defaultLanguageInput.value,
      },
    });
    await loadArena();
    state.battle.language = state.settings.defaultLanguage;
    renderAll();
    setMessage("Settings saved.");
  } catch (error) {
    setMessage(error.message, "bad");
  }
}

async function onCreateMatch(result) {
  try {
    const challenge = state.challenges.find((item) => item.id === state.battle.challengeId);
    const payload = {
      playerAId: state.battle.playerAId,
      playerBId: state.battle.playerBId,
      challengeId: state.battle.challengeId === "custom" ? null : state.battle.challengeId,
      challengeTitle: state.battle.challengeId === "custom" ? state.battle.customTitle.trim() : challenge?.title,
      challengePrompt: state.battle.challengeId === "custom" ? state.battle.customPrompt.trim() : challenge?.prompt,
      language: state.battle.language,
      codeA: state.battle.codeA,
      codeB: state.battle.codeB,
      notes: state.battle.notes,
      result,
    };

    await api("/api/matches", { method: "POST", body: payload });
    resetBattleEditors();
    await loadArena();
    setActiveTab("history");
    setMessage("Match saved.");
  } catch (error) {
    setMessage(error.message, "bad");
  }
}

function resetBattleEditors() {
  state.battle.codeA = `function solve(input) {
  return input;
}`;
  state.battle.codeB = `function solve(input) {
  return input;
}`;
  state.battle.notes = "";
  state.battle.customTitle = "";
  state.battle.customPrompt = "";
  state.battle.challengeId = state.challenges[0]?.id || "custom";
}

function lookupPlayerName(id) {
  return state.players.find((player) => player.id === id)?.name || "Unknown player";
}

function calculateElo(ratingA, ratingB, scoreA, kFactor) {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (ratingA - ratingB) / 400));
  const scoreB = 1 - scoreA;
  const newA = Math.round(ratingA + kFactor * (scoreA - expectedA));
  const newB = Math.round(ratingB + kFactor * (scoreB - expectedB));
  return {
    expectedA,
    expectedB,
    newA,
    newB,
    deltaA: newA - ratingA,
    deltaB: newB - ratingB,
  };
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function badgeTone(value) {
  if (value > 0) return "good";
  if (value < 0) return "bad";
  return "neutral";
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
