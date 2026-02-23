type Operator = "+" | "−" | "×" | "÷";

interface GeneratedQuestion {
  text: string;
  answer: number;
}

export function generateQuestion(): GeneratedQuestion {
  const operators: Operator[] = ["+", "−", "×", "÷"];
  const op = operators[Math.floor(Math.random() * operators.length)];

  let a: number, b: number, answer: number, text: string;

  switch (op) {
    case "+":
      a = randInt(10, 99);
      b = randInt(10, 99);
      answer = a + b;
      text = `${a} + ${b}`;
      break;
    case "−":
      a = randInt(20, 99);
      b = randInt(1, a); // ensure non-negative result
      answer = a - b;
      text = `${a} − ${b}`;
      break;
    case "×":
      a = randInt(2, 12);
      b = randInt(2, 12);
      answer = a * b;
      text = `${a} × ${b}`;
      break;
    case "÷":
      b = randInt(2, 12);
      answer = randInt(2, 12);
      a = b * answer; // guarantees integer result
      text = `${a} ÷ ${b}`;
      break;
    default:
      throw new Error("Unknown operator");
  }

  return { text, answer };
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
