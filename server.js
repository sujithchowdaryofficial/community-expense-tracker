require("dotenv").config();
const app = require("./src/app");
const db = require("./src/db");

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  try {
    await db.execute("SELECT 1");
    console.log("MySQL connected successfully!");

    app.listen(PORT, () => {
      console.log(
        `Community Expense Tracker running at http://localhost:${PORT}`,
      );
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
}

startServer();
