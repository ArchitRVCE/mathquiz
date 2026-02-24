"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ═══════════════════════════════════════════════════════
   NETWORK UTILITIES — retry with exponential backoff
   ═══════════════════════════════════════════════════════ */
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
  baseDelay = 500
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout per attempt
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

interface LeaderboardEntry {
  _id: string;
  username: string;
  score: number;
  highScore: number;
}

interface QuestionData {
  questionId: string;
  text: string;
  winnerId: string | null;
  winnerName: string | null;
  remainingMs: number;
  leaderboard: LeaderboardEntry[];
}

export default function Home() {
  // ── Auth state ──
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);

  // ── Quiz state ──
  const [question, setQuestion] = useState<QuestionData | null>(null);
  const [answerInput, setAnswerInput] = useState("");
  const [feedback, setFeedback] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);

  // ── Network health state ──
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "reconnecting" | "offline">("connected");
  const consecutiveFailures = useRef(0);
  const pollIntervalRef = useRef(1500); // adaptive polling interval in ms

  const lastQuestionId = useRef<string | null>(null);

  // ── Detect browser online/offline events ──
  useEffect(() => {
    const goOffline = () => setConnectionStatus("offline");
    const goOnline = () => {
      setConnectionStatus("connected");
      consecutiveFailures.current = 0;
      pollIntervalRef.current = 1500;
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // ── Restore session from sessionStorage ──
  useEffect(() => {
    const savedId = sessionStorage.getItem("playerId");
    const savedName = sessionStorage.getItem("username");
    if (savedId && savedName) {
      setPlayerId(savedId);
      setUsername(savedName);
    }
  }, []);

  // ── Join handler ──
  const handleJoin = async () => {
    if (!username.trim()) return;
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetchWithRetry("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setJoinError(data.error || "Failed to join");
        return;
      }
      setPlayerId(data.playerId);
      setUsername(data.username);
      sessionStorage.setItem("playerId", data.playerId);
      sessionStorage.setItem("username", data.username);
    } catch {
      setJoinError("Network error. Please try again.");
    } finally {
      setJoining(false);
    }
  };

  // ── Poll for question updates (with adaptive interval) ──
  const fetchQuestion = useCallback(async () => {
    try {
      const res = await fetchWithRetry("/api/question", undefined, 1, 300); // 1 retry for polling (fast)
      if (!res.ok) return;
      const data: QuestionData = await res.json();
      setQuestion(data);
      setTimeLeft(Math.ceil(data.remainingMs / 1000));

      // Network recovered — reset to fast polling
      if (consecutiveFailures.current > 0) {
        consecutiveFailures.current = 0;
        pollIntervalRef.current = 1500;
        setConnectionStatus("connected");
      }

      // If question changed, clear input and feedback
      if (data.questionId !== lastQuestionId.current) {
        lastQuestionId.current = data.questionId;
        setAnswerInput("");
        if (!data.winnerId) {
          setFeedback(null);
        }
      }
    } catch {
      // Adaptive backoff: slow down polling on consecutive failures
      consecutiveFailures.current += 1;
      if (consecutiveFailures.current >= 5) {
        setConnectionStatus("offline");
        pollIntervalRef.current = 10000; // 10s when offline
      } else if (consecutiveFailures.current >= 2) {
        setConnectionStatus("reconnecting");
        pollIntervalRef.current = 4000; // 4s when struggling
      }
    }
  }, []);

  useEffect(() => {
    if (!playerId) return;
    fetchQuestion();
    // Use dynamic interval via recursive setTimeout
    let timeoutId: ReturnType<typeof setTimeout>;
    const schedulePoll = () => {
      timeoutId = setTimeout(async () => {
        await fetchQuestion();
        schedulePoll();
      }, pollIntervalRef.current);
    };
    schedulePoll();
    return () => clearTimeout(timeoutId);
  }, [playerId, fetchQuestion]);

  // ── Count down timer locally ──
  useEffect(() => {
    if (!playerId) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [playerId]);

  // ── Submit answer ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerId || !question || submitting || answerInput.trim() === "") return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetchWithRetry("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          questionId: question.questionId,
          answer: Number(answerInput),
          submittedAt: Date.now(), // timestamp for network latency fairness
        }),
      }, 2, 300); // 2 retries, 300ms base delay for answers
      const data = await res.json();

      if (data.won) {
        setFeedback({ message: data.message, type: "success" });
      } else if (data.correct) {
        setFeedback({ message: data.message, type: "info" });
      } else {
        setFeedback({
          message: data.message || "Wrong answer!",
          type: "error",
        });
      }

      if (!data.correct) {
        setAnswerInput("");
      }
    } catch {
      setFeedback({
        message: "Network error. Please try again.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Logout ──
  const handleLogout = () => {
    setPlayerId(null);
    setUsername("");
    setQuestion(null);
    setFeedback(null);
    setAnswerInput("");
    sessionStorage.removeItem("playerId");
    sessionStorage.removeItem("username");
  };

  /* ═══════════════════════════════════════════════════════
     JOIN SCREEN
     ═══════════════════════════════════════════════════════ */
  if (!playerId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-700 p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <h1 className="text-3xl font-bold text-center text-gray-800 mb-2">
            ⚡ Math Quiz
          </h1>
          <p className="text-center text-gray-500 mb-6">
            Compete to solve math problems first!
          </p>

          <div className="space-y-4">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="Enter your username"
              maxLength={20}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-gray-800 text-lg transition-colors"
              autoFocus
            />
            <button
              onClick={handleJoin}
              disabled={joining || !username.trim()}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors text-lg"
            >
              {joining ? "Joining..." : "Join Quiz"}
            </button>
            {joinError && (
              <p className="text-red-500 text-center text-sm">{joinError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════
     QUIZ SCREEN
     ═══════════════════════════════════════════════════════ */
  const hasWinner = !!question?.winnerId;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 p-4">
      {/* Header */}
      <div className="max-w-5xl mx-auto flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">⚡ Math Quiz</h1>
        <div className="flex items-center gap-4">
          <span className="text-white/80 text-sm">
            Playing as <strong className="text-white">{username}</strong>
          </span>
          <button
            onClick={handleLogout}
            className="px-3 py-1 bg-white/20 hover:bg-white/30 text-white text-sm rounded-lg transition-colors"
          >
            Leave
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Connection Status Banner ── */}
        {connectionStatus !== "connected" && (
          <div className="lg:col-span-3">
            <div
              className={`rounded-xl p-3 text-center text-sm font-medium ${
                connectionStatus === "offline"
                  ? "bg-red-500/20 text-red-100 border border-red-400/30"
                  : "bg-yellow-500/20 text-yellow-100 border border-yellow-400/30"
              }`}
            >
              {connectionStatus === "offline"
                ? "⚠ Connection lost — retrying every 10s..."
                : "⏳ Slow connection — reconnecting..."}
            </div>
          </div>
        )}
        {/* ── Main Question Panel ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Timer */}
          <div className="bg-white/10 backdrop-blur rounded-xl p-3 flex items-center justify-between">
            <span className="text-white/80 text-sm">⏱ Time remaining</span>
            <span
              className={`font-mono text-lg font-bold ${
                timeLeft <= 10 ? "text-red-300" : "text-white"
              }`}
            >
              {timeLeft}s
            </span>
          </div>

          {/* Question Card */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
            {question ? (
              <>
                <p className="text-gray-500 text-sm mb-2 uppercase tracking-wide">
                  Solve this:
                </p>
                <p className="text-5xl font-bold text-gray-800 text-center py-6">
                  {question.text} = ?
                </p>

                {/* Winner banner */}
                {hasWinner && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4 text-center">
                    <p className="text-green-700 text-lg font-semibold">
                      🏆 {question.winnerName} won this round!
                    </p>
                    <p className="text-green-600 text-sm mt-1">
                      Next question coming soon...
                    </p>
                  </div>
                )}

                {/* Answer form */}
                {!hasWinner && (
                  <form onSubmit={handleSubmit} className="flex gap-3 mt-4">
                    <input
                      type="number"
                      value={answerInput}
                      onChange={(e) => setAnswerInput(e.target.value)}
                      placeholder="Your answer"
                      className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-gray-800 text-xl text-center transition-colors"
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={submitting || !answerInput.trim()}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold rounded-xl transition-colors text-lg"
                    >
                      {submitting ? "..." : "Submit"}
                    </button>
                  </form>
                )}

                {/* Feedback */}
                {feedback && (
                  <div
                    className={`mt-4 p-3 rounded-xl text-center font-medium ${
                      feedback.type === "success"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : feedback.type === "error"
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                    }`}
                  >
                    {feedback.message}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <div className="animate-spin inline-block w-8 h-8 border-4 border-indigo-300 border-t-indigo-600 rounded-full mb-4" />
                <p className="text-gray-500">Loading question...</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Leaderboard Panel ── */}
        <div className="bg-white rounded-2xl shadow-xl p-6 h-fit">
          <h2 className="text-xl font-bold text-gray-800 mb-4">
            🏅 Leaderboard
          </h2>
          {question?.leaderboard && question.leaderboard.length > 0 ? (
            <div className="space-y-2">
              {question.leaderboard.map((entry, i) => (
                <div
                  key={entry._id}
                  className={`flex items-center justify-between p-3 rounded-xl ${
                    i === 0
                      ? "bg-yellow-50 border border-yellow-200"
                      : i === 1
                        ? "bg-gray-100 border border-gray-200"
                        : i === 2
                          ? "bg-orange-50 border border-orange-200"
                          : "bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gray-400 w-6 text-center">
                      {i === 0
                        ? "🥇"
                        : i === 1
                          ? "🥈"
                          : i === 2
                            ? "🥉"
                            : `${i + 1}`}
                    </span>
                    <span
                      className={`font-medium ${
                        entry.username === username
                          ? "text-indigo-600"
                          : "text-gray-700"
                      }`}
                    >
                      {entry.username}
                      {entry.username === username && (
                        <span className="text-xs ml-1 text-indigo-400">
                          (you)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-gray-800">{entry.score}</span>
                    <span className="block text-xs text-amber-600 font-medium">
                      Best: {entry.highScore}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8">
              No scores yet. Be the first!
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
