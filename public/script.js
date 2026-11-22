const currency = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const $ = (id) => document.getElementById(id);
let cachedBills = [];

function showNotice(message, isError = false) {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = `notice show${isError ? " error" : ""}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => notice.classList.remove("show"), 5000);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function loadDashboard() {
  const d = await api("/api/dashboard");
  $("totalResidents").textContent = d.totalResidents;
  $("totalExpenses").textContent = currency(d.totalExpenses);
  $("totalCollected").textContent = currency(d.totalCollected);
  $("outstanding").textContent = currency(d.outstanding);
}

async function loadResidents() {
  const { residents } = await api("/api/residents");
  $("residentsTable").innerHTML =
    residents
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.flat_number)}</td><td>${escapeHtml(r.resident_name)}</td>
        <td>${escapeHtml(r.email || "—")}</td><td>${currency(r.flat_area_sqft)} sq. ft.</td>
        <td><button class="danger" data-deactivate="${r.id}">Deactivate</button></td>
      </tr>`,
      )
      .join("") || `<tr><td colspan="5">No residents registered yet.</td></tr>`;
}

async function loadExpenses() {
  const { expenses } = await api("/api/expenses");
  $("expensesTable").innerHTML =
    expenses
      .map(
        (e) => `
      <tr><td>${escapeHtml(String(e.expense_date).slice(0, 10))}</td>
      <td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.category)}</td>
      <td>${e.sharing_method === "equal" ? "Equal" : "By flat area"}</td>
      <td>${currency(e.amount)}</td></tr>`,
      )
      .join("") || `<tr><td colspan="5">No expenses added yet.</td></tr>`;
}

async function loadBills() {
  const { bills } = await api("/api/bills");
  cachedBills = bills;
  $("billsTable").innerHTML =
    bills
      .map(
        (b) => `
      <tr><td>${escapeHtml(String(b.bill_month).slice(0, 7))}</td>
      <td>${escapeHtml(b.flat_number)}</td><td>${escapeHtml(b.resident_name)}</td>
      <td>${currency(b.total_amount)}</td><td>${currency(b.amount_paid)}</td>
      <td>${currency(b.balance)}</td><td><span class="pill ${b.status}">${b.status}</span></td>
      <td>${Number(b.balance) > 0 ? `<button data-pay="${b.id}">Pay</button>` : "—"}</td></tr>`,
      )
      .join("") || `<tr><td colspan="8">No bills generated yet.</td></tr>`;

  const outstanding = bills.filter((b) => Number(b.balance) > 0);
  $("billSelect").innerHTML =
    `<option value="">Choose an outstanding bill</option>` +
    outstanding
      .map(
        (b) =>
          `<option value="${b.id}">${escapeHtml(b.flat_number)} · ${escapeHtml(b.resident_name)} · Balance ${currency(b.balance)}</option>`,
      )
      .join("");
}

async function loadPayments() {
  const { payments } = await api("/api/payments");
  $("paymentsTable").innerHTML =
    payments
      .map(
        (p) => `
      <tr><td>${escapeHtml(String(p.payment_date).slice(0, 10))}</td>
      <td>${escapeHtml(p.flat_number)}</td><td>${escapeHtml(p.resident_name)}</td>
      <td>${currency(p.amount)}</td><td>${escapeHtml(p.payment_method || "—")}</td></tr>`,
      )
      .join("") || `<tr><td colspan="5">No payments recorded yet.</td></tr>`;
}

async function refreshAll() {
  await Promise.all([
    loadDashboard(),
    loadResidents(),
    loadExpenses(),
    loadBills(),
    loadPayments(),
  ]);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}

$("residentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formObject(event.currentTarget);
  data.flat_area_sqft = Number(data.flat_area_sqft);
  try {
    await api("/api/residents", { method: "POST", body: JSON.stringify(data) });
    event.currentTarget.reset();
    showNotice("Resident registered successfully.");
    await refreshAll();
  } catch (error) {
    showNotice(error.message, true);
  }
});

$("expenseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formObject(event.currentTarget);
  data.amount = Number(data.amount);
  try {
    const result = await api("/api/expenses", {
      method: "POST",
      body: JSON.stringify(data),
    });
    event.currentTarget.reset();
    setTodayDate();
    showNotice(
      `Expense saved. Shares allocated to ${result.allocations.length} resident(s).`,
    );
    await refreshAll();
  } catch (error) {
    showNotice(error.message, true);
  }
});

$("paymentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formObject(event.currentTarget);
  data.bill_id = Number(data.bill_id);
  data.amount = Number(data.amount);
  try {
    await api("/api/payments", { method: "POST", body: JSON.stringify(data) });
    event.currentTarget.reset();
    showNotice("Payment recorded successfully.");
    await refreshAll();
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.addEventListener("click", async (event) => {
  const deactivateId = event.target.dataset.deactivate;
  const payBillId = event.target.dataset.pay;
  if (
    deactivateId &&
    confirm(
      "Deactivate this resident? Their old bills and payments will be kept.",
    )
  ) {
    try {
      await api(`/api/residents/${deactivateId}`, { method: "DELETE" });
      showNotice("Resident deactivated.");
      await refreshAll();
    } catch (error) {
      showNotice(error.message, true);
    }
  }
  if (payBillId) {
    $("billSelect").value = payBillId;
    $("paymentForm").scrollIntoView({ behavior: "smooth", block: "center" });
    $("paymentForm").elements.amount.focus();
  }
});

function setTodayDate() {
  const today = new Date();
  const localDate = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 10);
  $("expenseForm").elements.expense_date.value = localDate;
  $("paymentForm").elements.payment_date.value = localDate;
}

setTodayDate();
refreshAll().catch((error) => showNotice(error.message, true));
