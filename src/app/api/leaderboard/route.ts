import { NextResponse } from "next/server";
import dbConnect from "@/lib/db/connect";
import { Player } from "@/lib/db/models";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await dbConnect();

    const leaderboard = await Player.find({})
      .sort({ score: -1 })
      .limit(10)
      .select("username score highScore");

    return NextResponse.json({ leaderboard });
  } catch (error: unknown) {
    console.error("Leaderboard error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
