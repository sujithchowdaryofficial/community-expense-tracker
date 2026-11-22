CREATE DATABASE IF NOT EXISTS community_expense_tracker;
USE community_expense_tracker;

CREATE TABLE IF NOT EXISTS residents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    flat_number VARCHAR(20) NOT NULL,
    resident_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(15),
    flat_area_sqft DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT,
    amount DECIMAL(10,2) NOT NULL,
    expense_date DATE NOT NULL,
    sharing_method ENUM('equal', 'flat_size') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expense_allocations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    expense_id INT NOT NULL,
    resident_id INT NOT NULL,
    allocated_amount DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (expense_id) REFERENCES expenses(id),
    FOREIGN KEY (resident_id) REFERENCES residents(id),
    UNIQUE (expense_id, resident_id)
);

CREATE TABLE IF NOT EXISTS maintenance_bills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    resident_id INT NOT NULL,
    bill_month DATE NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    amount_paid DECIMAL(10,2) DEFAULT 0,
    status ENUM('pending', 'partial', 'paid') DEFAULT 'pending',
    FOREIGN KEY (resident_id) REFERENCES residents(id),
    UNIQUE (resident_id, bill_month)
);

CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bill_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(30),
    FOREIGN KEY (bill_id) REFERENCES maintenance_bills(id)
);
