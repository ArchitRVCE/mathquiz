import { NextResponse } from "next/server";
import dbConnect from "@/lib/db/connect";
import { Question, Player } from "@/lib/db/models";
import { generateQuestion } from "@/lib/questions";

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { playerId, questionId, answer } = (await req.json()) as {
      playerId?: string;
      questionId?: string;
      answer?: number;
    };

    if (!playerId || !questionId || answer === undefined || answer === null) {
      return NextResponse.json(
        { error: "playerId, questionId, and answer are required" },
        { status: 400 }
      );
    }

    const numAnswer = Number(answer);
    if (isNaN(numAnswer)) {
      return NextResponse.json({ error: "Answer must be a number" }, { status: 400 });
    }

    // Fetch the question to check the answer
    const question = await Question.findById(questionId);
    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    if (!question.isActive) {
      return NextResponse.json({ correct: false, won: false, message: "Question is no longer active" });
    }

    if (question.winnerId) {
      return NextResponse.json({ correct: false, won: false, message: "Someone already answered correctly" });
    }

    // Check if the answer is correct
    if (numAnswer !== question.answer) {
      return NextResponse.json({ correct: false, won: false, message: "Wrong answer, try again!" });
    }

    // Answer is correct — try to claim the win atomically
    const player = await Player.findById(playerId);
    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    // Atomic update: only set winnerId if it's still null
    const result = await Question.findOneAndUpdate(
      { _id: questionId, winnerId: null, isActive: true },
      { winnerId: playerId, winnerName: player.username },
      { new: true }
    );

    if (!result) {
      // Someone beat us to it
      return NextResponse.json({ correct: true, won: false, message: "Correct, but someone was faster!" });
    }

    // Increment the player's score
    await Player.findByIdAndUpdate(playerId, { $inc: { score: 1 } });

    // Deactivate this question and create the next one after a short delay
    // (the next question will be created when /api/question is polled and finds no active question)
    // We'll deactivate after a brief window so clients can see the winner
    setTimeout(async () => {
      try {
        await Question.findByIdAndUpdate(questionId, { isActive: false });
        const q = generateQuestion();
        await Question.create({ text: q.text, answer: q.answer, isActive: true });
      } catch (e) {
        console.error("Error creating next question:", e);
      }
    }, 3000); // 3-second gap to show the winner

    return NextResponse.json({
      correct: true,
      won: true,
      message: `🏆 ${player.username} wins!`,
    });
  } catch (error: unknown) {
    console.error("Answer error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
