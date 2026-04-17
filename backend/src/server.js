import express from "express";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "../../frontend");

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";
const SESSION_COOKIE_NAME = "elo_code_arena_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const cookieSecure = process.env.NODE_ENV === "production" || String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true";

app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function calculateElo(ratingA, ratingB, scoreA, kFactor) {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);
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

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
  };
}

function parseCookies(cookieHeader = "") {
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    buildCookie(SESSION_COOKIE_NAME, token, {
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: cookieSecure,
    })
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    buildCookie(SESSION_COOKIE_NAME, "", {
      maxAge: 0,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: cookieSecure,
    })
  );
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt,
    },
  });
  setSessionCookie(res, token);
}

async function destroySessionByToken(token) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}

async function authMiddleware(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[SESSION_COOKIE_NAME];
    req.sessionToken = token || null;
    req.currentUser = null;
    req.currentSession = null;

    if (!token) return next();

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session) {
      clearSessionCookie(res);
      return next();
    }

    if (session.expiresAt <= new Date()) {
      await prisma.session.delete({ where: { token } }).catch(() => {});
      clearSessionCookie(res);
      return next();
    }

    req.currentSession = session;
    req.currentUser = session.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    return res.status(401).json({ error: "Not authenticated." });
  }
  next();
}

async function seedUserArena(userId) {
  const settings = await prisma.appSettings.findUnique({ where: { userId } });
  if (!settings) {
    await prisma.appSettings.create({
      data: {
        userId,
        kFactor: 32,
        defaultLanguage: "JavaScript",
      },
    });
  }

  const playerCount = await prisma.player.count({ where: { userId } });
  if (playerCount === 0) {
    await prisma.player.createMany({
      data: ["Ruben", "Alex", "Sam"].map((name) => ({ userId, name })),
      skipDuplicates: true,
    });
  }

  const challengeCount = await prisma.challenge.count({ where: { userId } });
  if (challengeCount === 0) {
    await prisma.challenge.createMany({
      data: [
        {
          userId,
          title: "FizzBuzz",
          difficulty: "Easy",
          prompt:
            "Print numbers from 1 to 100. For multiples of 3 print Fizz, for multiples of 5 print Buzz, and for both print FizzBuzz.",
        },
        {
          userId,
          title: "Two Sum",
          difficulty: "Medium",
          prompt:
            "Given an array of integers and a target, return the indices of the two numbers that add up to the target.",
        },
        {
          userId,
          title: "Balanced Brackets",
          difficulty: "Medium",
          prompt:
            "Determine whether a bracket string is balanced using a stack-based approach.",
        },
      ],
    });
  }
}

app.use(authMiddleware);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/session", async (req, res, next) => {
  try {
    if (!req.currentUser) {
      return res.json({ authenticated: false, user: null });
    }

    res.json({ authenticated: true, user: sanitizeUser(req.currentUser) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const compatibilityEmail = `${username.toLowerCase().replace(/[^a-z0-9_\-.]/g, "-")}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}@internal.local`;
    const user = await prisma.user.create({
      data: { username, email: compatibilityEmail, passwordHash },
    });

    await seedUserArena(user.id);
    await createSession(res, user.id);

    res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Username already exists." });
    }
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    if (req.sessionToken) {
      await destroySessionByToken(req.sessionToken);
    }
    await seedUserArena(user.id);
    await createSession(res, user.id);

    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuth, async (req, res, next) => {
  try {
    await destroySessionByToken(req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/bootstrap", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser.id;
    const [players, challenges, matches, settings] = await Promise.all([
      prisma.player.findMany({
        where: { userId },
        orderBy: [{ rating: "desc" }, { wins: "desc" }, { name: "asc" }],
      }),
      prisma.challenge.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.match.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.appSettings.findUnique({ where: { userId } }),
    ]);

    res.json({
      players,
      challenges,
      matches,
      settings: settings || { kFactor: 32, defaultLanguage: "JavaScript" },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/players", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser.id;
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Player name is required." });
    }

    const player = await prisma.player.create({
      data: { userId, name },
    });

    res.status(201).json(player);
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ error: "This player name already exists in your arena." });
    }
    next(error);
  }
});

app.delete("/api/players/:id", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser.id;
    const id = req.params.id;

    const player = await prisma.player.findFirst({ where: { id, userId } });
    if (!player) {
      return res.status(404).json({ error: "Player not found." });
    }

    const matchCount = await prisma.match.count({
      where: {
        userId,
        OR: [{ playerAId: id }, { playerBId: id }],
      },
    });

    if (matchCount > 0) {
      return res.status(400).json({ error: "Cannot remove a player with recorded matches." });
    }

    await prisma.player.delete({ where: { id } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/challenges", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser.id;
    const title = String(req.body?.title || "").trim();
    const prompt = String(req.body?.prompt || "").trim();
    const difficulty = String(req.body?.difficulty || "Medium").trim() || "Medium";

    if (!title || !prompt) {
      return res.status(400).json({ error: "Challenge title and prompt are required." });
    }

    const challenge = await prisma.challenge.create({
      data: { userId, title, prompt, difficulty },
    });

    res.status(201).json(challenge);
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser.id;
    const kFactor = Math.max(4, Math.min(128, Number(req.body?.kFactor) || 32));
    const defaultLanguage = String(req.body?.defaultLanguage || "JavaScript").trim() || "JavaScript";

    const settings = await prisma.appSettings.upsert({
      where: { userId },
      update: { kFactor, defaultLanguage },
      create: { userId, kFactor, defaultLanguage },
    });

    res.json(settings);
  } catch (error) {
    next(error);
  }
});

app.post("/api/matches", requireAuth, async (req, res, next) => {
  try {
    const userId = req.currentUser.id;
    const {
      playerAId,
      playerBId,
      challengeId = null,
      challengeTitle,
      challengePrompt,
      language,
      codeA,
      codeB,
      notes,
      result,
    } = req.body || {};

    if (!playerAId || !playerBId) {
      return res.status(400).json({ error: "Both players are required." });
    }
    if (playerAId === playerBId) {
      return res.status(400).json({ error: "Players must be different." });
    }
    if (!["A", "B", "DRAW"].includes(result)) {
      return res.status(400).json({ error: "Invalid match result." });
    }

    const payloadChallengeTitle = String(challengeTitle || "").trim();
    const payloadChallengePrompt = String(challengePrompt || "").trim();
    const safeLanguage = String(language || "JavaScript").trim() || "JavaScript";
    const safeCodeA = String(codeA || "");
    const safeCodeB = String(codeB || "");
    const safeNotes = String(notes || "").trim() || null;

    const [playerA, playerB, settings, challenge] = await Promise.all([
      prisma.player.findFirst({ where: { id: playerAId, userId } }),
      prisma.player.findFirst({ where: { id: playerBId, userId } }),
      prisma.appSettings.findUnique({ where: { userId } }),
      challengeId ? prisma.challenge.findFirst({ where: { id: challengeId, userId } }) : Promise.resolve(null),
    ]);

    if (!playerA || !playerB) {
      return res.status(404).json({ error: "One or both players were not found." });
    }

    const finalChallengeTitle = challenge?.title || payloadChallengeTitle || "Custom Coding Challenge";
    const finalChallengePrompt = challenge?.prompt || payloadChallengePrompt || "No prompt provided.";
    const scoreA = result === "A" ? 1 : result === "DRAW" ? 0.5 : 0;
    const kFactor = settings?.kFactor || 32;
    const elo = calculateElo(playerA.rating, playerB.rating, scoreA, kFactor);

    const match = await prisma.$transaction(async (tx) => {
      await tx.player.update({
        where: { id: playerA.id },
        data: {
          rating: elo.newA,
          wins: playerA.wins + (result === "A" ? 1 : 0),
          losses: playerA.losses + (result === "B" ? 1 : 0),
          draws: playerA.draws + (result === "DRAW" ? 1 : 0),
        },
      });

      await tx.player.update({
        where: { id: playerB.id },
        data: {
          rating: elo.newB,
          wins: playerB.wins + (result === "B" ? 1 : 0),
          losses: playerB.losses + (result === "A" ? 1 : 0),
          draws: playerB.draws + (result === "DRAW" ? 1 : 0),
        },
      });

      return tx.match.create({
        data: {
          userId,
          playerAId: playerA.id,
          playerBId: playerB.id,
          challengeId: challenge?.id || null,
          challengeTitle: finalChallengeTitle,
          challengePrompt: finalChallengePrompt,
          language: safeLanguage,
          codeA: safeCodeA,
          codeB: safeCodeB,
          notes: safeNotes,
          result,
          winnerId: result === "A" ? playerA.id : result === "B" ? playerB.id : null,
          ratingBeforeA: playerA.rating,
          ratingBeforeB: playerB.rating,
          ratingAfterA: elo.newA,
          ratingAfterB: elo.newB,
          deltaA: elo.deltaA,
          deltaB: elo.deltaB,
          expectedA: elo.expectedA,
          expectedB: elo.expectedB,
        },
      });
    });

    res.status(201).json(match);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(frontendDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return next();
  }
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Server error." });
});

app.listen(port, host, () => {
  console.log(`Elo Code Arena running on ${host}:${port}`);
});
