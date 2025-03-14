const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 5000;
const ONE_HOUR_MS = 60 * 60 * 1000;

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: "https://coupon-app-frontend-pied.vercel.app/",
    credentials: true,
  })
);
const initializeDatabase = (db) => {
  db.run(
    `CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE
    )`,
    (err) => {
      if (err) return console.error("Coupons table error:", err);

      console.log("Coupons table ready");
      seedInitialCoupons(db);
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT,
      cookie TEXT,
      timestamp INTEGER
    )`,
    (err) => {
      if (err) return console.error("Claims table error:", err);
      console.log("Claims table ready");
    }
  );
};

// data
const seedInitialCoupons = (db) => {
  const coupons = ["DISCOUNT10", "SAVE20", "OFFER30", "DEAL40"];
  coupons.forEach((code) => {
    db.run("INSERT OR IGNORE INTO coupons (code) VALUES (?)", [code], (err) => {
      if (err) console.error("Coupon insertion error:", code, err);
    });
  });
};

// Database connection setup
const db = new sqlite3.Database("./coupons.db", (err) => {
  if (err) return console.error("Database connection error:", err);
  console.log("Connected to SQLite database");
  initializeDatabase(db);
});

// Retrieves the next available coupon from the database

const getNextCoupon = (callback) => {
  db.get("SELECT * FROM coupons ORDER BY id ASC LIMIT 1", [], (err, row) => {
    if (err) {
      console.error("Coupon retrieval error:", err);
      return callback(null);
    }
    callback(row);
  });
};

// Middleware to prevent abuse through IP and cookie tracking

const checkAbuse = (req, res, next) => {
  const userIP = req.ip;
  const userCookie =
    req.cookies?.user_session || Math.random().toString(36).substring(2);
  const oneHourAgo = Date.now() - ONE_HOUR_MS;

  db.get(
    `SELECT * FROM claims 
     WHERE (ip = ? OR cookie = ?) 
     AND timestamp > ?`,
    [userIP, userCookie, oneHourAgo],
    (err, row) => {
      if (err) return res.status(500).json({ message: "Server error" });

      if (row) {
        const timeLeft = Math.ceil(
          (row.timestamp + ONE_HOUR_MS - Date.now()) / 1000
        );
        return res.status(429).json({
          message: `Please wait ${timeLeft} seconds before claiming again.`,
        });
      }

      if (!req.cookies?.user_session) {
        res.cookie("user_session", userCookie, {
          maxAge: ONE_HOUR_MS,
          httpOnly: true,
        });
      }
      next();
    }
  );
};

// Claim coupon endpoint with abuse prevention

app.get("/claim-coupon", checkAbuse, (req, res) => {
  getNextCoupon((coupon) => {
    if (!coupon) {
      return res.status(400).json({ message: "No coupons available" });
    }

    const claimData = {
      ip: req.ip,
      cookie: req.cookies?.user_session,
      timestamp: Date.now(),
    };

    // Record claim and remove coupon
    db.serialize(() => {
      db.run(
        "INSERT INTO claims (ip, cookie, timestamp) VALUES (?, ?, ?)",
        [claimData.ip, claimData.cookie, claimData.timestamp],
        (err) => {
          if (err) console.error("Claim recording error:", err);
        }
      );

      db.run("DELETE FROM coupons WHERE id = ?", [coupon.id], (err) => {
        if (err) console.error("Coupon deletion error:", err);
      });
    });

    res.json({
      message: "Coupon claimed successfully",
      coupon: coupon.code,
    });
  });
});

// Check claim status endpoint

app.get("/status", (req, res) => {
  const checkParams = {
    ip: req.ip,
    cookie: req.cookies?.user_session,
    timestamp: Date.now() - ONE_HOUR_MS,
  };

  db.get(
    `SELECT * FROM claims 
     WHERE (ip = ? OR cookie = ?) 
     AND timestamp > ?`,
    [checkParams.ip, checkParams.cookie, checkParams.timestamp],
    (err, row) => {
      if (err) return res.status(500).json({ message: "Server error" });

      if (row) {
        const timeLeft = Math.ceil(
          (row.timestamp + ONE_HOUR_MS - Date.now()) / 1000
        );
        return res.json({ canClaim: false, timeLeft });
      }
      res.json({ canClaim: true });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
