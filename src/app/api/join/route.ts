import { NextResponse } from "next/server";
import dbConnect from "@/lib/db/connect";
import { Player } from "@/lib/db/models";

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { username } = (await req.json()) as { username?: string };

    if (!username || username.trim().length === 0) {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }

    const trimmed = username.trim().substring(0, 20); // cap length
    
    // Upsert: create player if not exists, otherwise return existing
    let player = await Player.findOne({ username: trimmed });
    if (!player) {
      player = await Player.create({ username: trimmed, score: 0 });
    }

    return NextResponse.json({
      playerId: player._id,
      username: player.username,
      score: player.score,
    });
  } catch (error: unknown) {
    console.error("Join error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
