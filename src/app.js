const express = require("express");
const path = require("path");
const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

app.get(
  "/api/health",
  asyncHandler(async (req, res) => {
    await db.execute("SELECT 1");
    res.json({ message: "API and database are working" });
  }),
);

// RESIDENTS: list active residents
app.get(
  "/api/residents",
  asyncHandler(async (req, res) => {
    const [residents] = await db.execute(
      "SELECT * FROM residents WHERE is_active = TRUE ORDER BY flat_number",
    );
    res.json({ residents });
  }),
);

// RESIDENTS: register
app.post(
  "/api/residents",
  asyncHandler(async (req, res) => {
    const { flat_number, resident_name, email, phone, flat_area_sqft } =
      req.body;

    if (!flat_number || !resident_name || !positiveNumber(flat_area_sqft)) {
      return res.status(400).json({
        message:
          "Flat number, resident name and a positive flat area are required",
      });
    }

    const [result] = await db.execute(
      `INSERT INTO residents
         (flat_number, resident_name, email, phone, flat_area_sqft)
         VALUES (?, ?, ?, ?, ?)`,
      [
        String(flat_number).trim(),
        String(resident_name).trim(),
        email || null,
        phone || null,
        Number(flat_area_sqft),
      ],
    );

    res.status(201).json({
      message: "Resident registered successfully",
      residentId: result.insertId,
    });
  }),
);

// RESIDENTS: update
app.put(
  "/api/residents/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { flat_number, resident_name, email, phone, flat_area_sqft } =
      req.body;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid resident ID" });
    }
    if (!flat_number || !resident_name || !positiveNumber(flat_area_sqft)) {
      return res.status(400).json({
        message:
          "Flat number, resident name and a positive flat area are required",
      });
    }

    const [result] = await db.execute(
      `UPDATE residents
         SET flat_number = ?, resident_name = ?, email = ?, phone = ?, flat_area_sqft = ?
         WHERE id = ? AND is_active = TRUE`,
      [
        String(flat_number).trim(),
        String(resident_name).trim(),
        email || null,
        phone || null,
        Number(flat_area_sqft),
        id,
      ],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Resident not found" });
    }
    res.json({ message: "Resident updated successfully" });
  }),
);

// RESIDENTS: deactivate (keeps old financial records intact)
app.delete(
  "/api/residents/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid resident ID" });
    }

    const [result] = await db.execute(
      "UPDATE residents SET is_active = FALSE WHERE id = ? AND is_active = TRUE",
      [id],
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: "Active resident not found" });
    }
    res.json({ message: "Resident deactivated successfully" });
  }),
);

// EXPENSES: list expenses with total allocation
app.get(
  "/api/expenses",
  asyncHandler(async (req, res) => {
    const [expenses] = await db.execute(
      `SELECT e.*,
                COALESCE(SUM(a.allocated_amount), 0) AS allocated_total
         FROM expenses e
         LEFT JOIN expense_allocations a ON a.expense_id = e.id
         GROUP BY e.id
         ORDER BY e.expense_date DESC, e.id DESC`,
    );
    res.json({ expenses });
  }),
);

// EXPENSES: create expense and allocate it to all active residents
app.post(
  "/api/expenses",
  asyncHandler(async (req, res) => {
    const {
      title,
      category,
      description,
      amount,
      expense_date,
      sharing_method,
    } = req.body;

    if (
      !title ||
      !category ||
      !positiveNumber(amount) ||
      !expense_date ||
      !["equal", "flat_size"].includes(sharing_method)
    ) {
      return res.status(400).json({
        message:
          "Title, category, positive amount, date and valid sharing method are required",
      });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [residents] = await connection.execute(
        "SELECT id, flat_area_sqft FROM residents WHERE is_active = TRUE ORDER BY id",
      );
      if (residents.length === 0) {
        await connection.rollback();
        return res
          .status(400)
          .json({
            message:
              "Register at least one active resident before adding an expense",
          });
      }

      const totalCents = Math.round(Number(amount) * 100);
      const weights = residents.map((r) =>
        sharing_method === "equal" ? 1 : Number(r.flat_area_sqft),
      );
      const weightTotal = weights.reduce((sum, value) => sum + value, 0);

      // Round each share to cents; put any rounding remainder on the final resident.
      let assignedCents = 0;
      const allocations = residents.map((resident, index) => {
        let cents;
        if (index === residents.length - 1) {
          cents = totalCents - assignedCents;
        } else {
          cents = Math.floor((totalCents * weights[index]) / weightTotal + 0.5);
          assignedCents += cents;
        }
        return { residentId: resident.id, amount: (cents / 100).toFixed(2) };
      });

      const [expenseResult] = await connection.execute(
        `INSERT INTO expenses (title, category, description, amount, expense_date, sharing_method)
             VALUES (?, ?, ?, ?, ?, ?)`,
        [
          String(title).trim(),
          String(category),
          description || null,
          Number(amount),
          expense_date,
          sharing_method,
        ],
      );

      const expenseId = expenseResult.insertId;
      const billMonth = `${expense_date.slice(0, 7)}-01`;

      for (const allocation of allocations) {
        await connection.execute(
          `INSERT INTO expense_allocations (expense_id, resident_id, allocated_amount)
                 VALUES (?, ?, ?)`,
          [expenseId, allocation.residentId, allocation.amount],
        );

        await connection.execute(
          `INSERT INTO maintenance_bills (resident_id, bill_month, total_amount)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE total_amount = total_amount + VALUES(total_amount)`,
          [allocation.residentId, billMonth, allocation.amount],
        );
      }

      await connection.commit();
      res.status(201).json({
        message: "Expense added and shares allocated successfully",
        expenseId,
        sharing_method,
        allocations,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

// BILLING: list monthly bills
app.get(
  "/api/bills",
  asyncHandler(async (req, res) => {
    const [bills] = await db.execute(
      `SELECT b.*, r.flat_number, r.resident_name,
                GREATEST(b.total_amount - b.amount_paid, 0) AS balance
         FROM maintenance_bills b
         JOIN residents r ON r.id = b.resident_id
         ORDER BY b.bill_month DESC, r.flat_number`,
    );
    res.json({ bills });
  }),
);

// PAYMENTS: list payments
app.get(
  "/api/payments",
  asyncHandler(async (req, res) => {
    const [payments] = await db.execute(
      `SELECT p.*, b.bill_month, r.flat_number, r.resident_name
         FROM payments p
         JOIN maintenance_bills b ON b.id = p.bill_id
         JOIN residents r ON r.id = b.resident_id
         ORDER BY p.payment_date DESC, p.id DESC`,
    );
    res.json({ payments });
  }),
);

// PAYMENTS: record payment against a bill
app.post(
  "/api/payments",
  asyncHandler(async (req, res) => {
    const { bill_id, amount, payment_date, payment_method } = req.body;
    const id = Number(bill_id);

    if (!Number.isInteger(id) || id <= 0 || !positiveNumber(amount)) {
      return res
        .status(400)
        .json({
          message: "A valid bill ID and positive payment amount are required",
        });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [bills] = await connection.execute(
        "SELECT * FROM maintenance_bills WHERE id = ? FOR UPDATE",
        [id],
      );
      if (!bills.length) {
        await connection.rollback();
        return res.status(404).json({ message: "Bill not found" });
      }

      const bill = bills[0];
      const balance = money(
        Number(bill.total_amount) - Number(bill.amount_paid),
      );
      const paymentAmount = money(amount);

      if (paymentAmount > balance) {
        await connection.rollback();
        return res
          .status(400)
          .json({
            message: `Payment exceeds outstanding balance of ${balance.toFixed(2)}`,
          });
      }

      await connection.execute(
        `INSERT INTO payments (bill_id, amount, payment_date, payment_method)
             VALUES (?, ?, COALESCE(?, CURDATE()), ?)`,
        [id, paymentAmount, payment_date || null, payment_method || "Other"],
      );

      const newPaid = money(Number(bill.amount_paid) + paymentAmount);
      const status = newPaid >= Number(bill.total_amount) ? "paid" : "partial";

      await connection.execute(
        "UPDATE maintenance_bills SET amount_paid = ?, status = ? WHERE id = ?",
        [newPaid, status, id],
      );

      await connection.commit();
      res
        .status(201)
        .json({
          message: "Payment recorded successfully",
          status,
          amount_paid: newPaid,
        });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }),
);

// DASHBOARD: quick totals
app.get(
  "/api/dashboard",
  asyncHandler(async (req, res) => {
    const [[residentStats]] = await db.execute(
      "SELECT COUNT(*) AS totalResidents FROM residents WHERE is_active = TRUE",
    );
    const [[expenseStats]] = await db.execute(
      "SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expenses",
    );
    const [[billStats]] = await db.execute(
      `SELECT COALESCE(SUM(total_amount), 0) AS totalBilled,
                COALESCE(SUM(amount_paid), 0) AS totalCollected,
                COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)), 0) AS outstanding
         FROM maintenance_bills`,
    );
    res.json({ ...residentStats, ...expenseStats, ...billStats });
  }),
);

// Unknown API route
app.use("/api", (req, res) => {
  res.status(404).json({ message: "API route not found" });
});

// Central error handler
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    message: "Something went wrong on the server",
    error: process.env.NODE_ENV === "development" ? error.message : undefined,
  });
});

module.exports = app;
