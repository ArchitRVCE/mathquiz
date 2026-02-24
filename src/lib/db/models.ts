import mongoose, { Schema, Document, Model } from "mongoose";

/* ── Player ─────────────────────────────────────────── */
export interface IPlayer extends Document {
  username: string;
  score: number;
  highScore: number;
  createdAt: Date;
}

const PlayerSchema = new Schema<IPlayer>(
  {
    username: { type: String, required: true, unique: true },
    score: { type: Number, default: 0 },
    highScore: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Player: Model<IPlayer> =
  mongoose.models.Player || mongoose.model<IPlayer>("Player", PlayerSchema);

/* ── Question ───────────────────────────────────────── */
export interface IQuestion extends Document {
  text: string;
  answer: number;
  isActive: boolean;
  winnerId: mongoose.Types.ObjectId | null;
  winnerName: string | null;
  createdAt: Date;
}

const QuestionSchema = new Schema<IQuestion>(
  {
    text: { type: String, required: true },
    answer: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
    winnerId: { type: Schema.Types.ObjectId, ref: "Player", default: null },
    winnerName: { type: String, default: null },
  },
  { timestamps: true }
);

export const Question: Model<IQuestion> =
  mongoose.models.Question ||
  mongoose.model<IQuestion>("Question", QuestionSchema);
