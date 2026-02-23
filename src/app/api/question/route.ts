import { NextResponse } from "next/server";
import dbConnect from "@/lib/db/connect";
import { Question, Player } from "@/lib/db/models";
import { generateQuestion } from "@/lib/questions";

const QUESTION_TIMEOUT_MS = 60_000; // 60 seconds

export const dynamic = "force-dynamic"; // disable caching

export async function GET() {
  try {
    await dbConnect();

    // Find the current active question
    let question = await Question.findOne({ isActive: true }).sort({ createdAt: -1 });

    // If no active question, or the active question has timed out, create a new one
    if (!question) {
      const q = generateQuestion();
      question = await Question.create({
        text: q.text,
        answer: q.answer,
        isActive: true,
      });
    } else if (
      !question.winnerId &&
      Date.now() - new Date(question.createdAt).getTime() > QUESTION_TIMEOUT_MS
    ) {
      // Question timed out with no winner — retire it and create a new one
      question.isActive = false;
      await question.save();

      const q = generateQuestion();
      question = await Question.create({
        text: q.text,
        answer: q.answer,
        isActive: true,
      });
    }

    // Get the leaderboard (top 10)
    const leaderboard = await Player.find({})
      .sort({ score: -1 })
      .limit(10)
      .select("username score");

    const elapsed = Date.now() - new Date(question.createdAt).getTime();
    const remainingMs = Math.max(0, QUESTION_TIMEOUT_MS - elapsed);

    return NextResponse.json({
      questionId: question._id,
      text: question.text,
      winnerId: question.winnerId,
      winnerName: question.winnerName,
      remainingMs,
      leaderboard,
    });
  } catch (error: unknown) {
    console.error("Question fetch error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
