import express from "express";
import path from "path";
import dotenv from "dotenv";
import { authRouter } from "./routes/auth";
import { calendarRouter } from "./routes/calendar";
import { quoteRouter } from "./routes/quote";
import { checklistRouter } from "./routes/checklist";

dotenv.config();

const app = express();
const PORT = process.env.WEB_PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/auth", authRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/quote", quoteRouter);
app.use("/api/checklist", checklistRouter);

app.listen(PORT, () => {
  console.log(`\n🏠 MOZU Web App 起動中`);
  console.log(`   http://localhost:${PORT}\n`);
});
