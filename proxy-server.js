const express = require("express");
const fetch = require("node-fetch");
const app = express();
const sql = require("mssql");
const path = require("path");

// ── SQL Server 配置 ─────────────────────────────────────────────
const DB_NAME = "AGV_PDA_LOG";
const sqlConfig = {
  user: "sa",
  password: "123456",
  server: "DESKTOP-L654TSI",
  // password: "Byt123",
  // server: "WIN-5LORRTP7E4T",
  database: "master", // 先连 master，建库后切换
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let pool = null;

async function getPool() {
  if (pool) return pool;
  const masterPool = await sql.connect(sqlConfig);

  // 建库（如不存在）
  await masterPool.request().query(`
    IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'${DB_NAME}')
      CREATE DATABASE [${DB_NAME}]
  `);

  // 切换到目标库
  await masterPool.close();
  pool = await new sql.ConnectionPool({
    ...sqlConfig,
    database: DB_NAME,
  }).connect();

  // 建表（如不存在）
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'task_log'
    )
    CREATE TABLE task_log (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      req_code       NVARCHAR(100),
      task_typ       NVARCHAR(50),
      position_codes NVARCHAR(MAX),
      raw_body       NVARCHAR(MAX),
      resp_status    INT,
      resp_body      NVARCHAR(MAX),
      created_at     DATETIME DEFAULT GETDATE()
    )
  `);

  console.log("[DB] Connected to", DB_NAME);
  return pool;
}

// 启动时初始化（失败不阻断代理本身）
getPool().catch((err) => console.error("[DB] Init error:", err.message));

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname)));

// 添加 CORS 头，允许浏览器直接访问本地代理
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.post("/proxy", async (req, res) => {
  const { url, method = "GET", headers = {}, body } = req.body || {};

  // 调试日志
  console.log("Proxy request:");
  console.log("  URL:", url);
  console.log("  Method:", method);
  console.log("  Headers:", headers);
  console.log("  Body:", body);

  if (!url) {
    console.log("ERROR: missing url");
    return res.status(400).send("missing url");
  }

  try {
    const opts = { method, headers: headers || {} };
    if (body !== undefined && body !== null && body !== "") {
      // 如果 body 是 JSON 字符串，直接发送；如果是对象，转换为 JSON
      opts.body = typeof body === "string" ? body : JSON.stringify(body);
      // 如果 headers 中没有 content-type，则默认设置为 JSON
      const hasContentType = Object.keys(opts.headers).some(
        (h) => h.toLowerCase() === "content-type",
      );
      if (!hasContentType) {
        opts.headers["Content-Type"] = "application/json";
      }
    }

    console.log("Forwarding request to:", url);
    console.log("Options:", opts);

    const upstream = await fetch(url, opts);
    const text = await upstream.text();

    console.log("Response status:", upstream.status);
    // 将上游的状态码和响应体返回给调用者
    res.status(upstream.status).send(text);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error: " + String(err));
  }
});

// ── 写入任务日志 ────────────────────────────────────────────────
app.post("/api/task-log", async (req, res) => {
  try {
    const { reqCode, taskTyp, positionCodes, rawBody, respStatus, respBody } =
      req.body || {};
    const p = await getPool();
    await p
      .request()
      .input("req_code", sql.NVarChar(100), reqCode || "")
      .input("task_typ", sql.NVarChar(50), taskTyp || "")
      .input(
        "position_codes",
        sql.NVarChar(sql.MAX),
        typeof positionCodes === "string"
          ? positionCodes
          : JSON.stringify(positionCodes || []),
      )
      .input(
        "raw_body",
        sql.NVarChar(sql.MAX),
        typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody || {}),
      )
      .input("resp_status", sql.Int, respStatus || 0)
      .input("resp_body", sql.NVarChar(sql.MAX), respBody || "").query(`
        INSERT INTO task_log (req_code, task_typ, position_codes, raw_body, resp_status, resp_body)
        VALUES (@req_code, @task_typ, @position_codes, @raw_body, @resp_status, @resp_body)
      `);
    res.json({ ok: true });
  } catch (err) {
    console.error("[DB] task-log insert error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 查询统计数据 ────────────────────────────────────────────────
app.get("/api/task-stats", async (req, res) => {
  try {
    const p = await getPool();

    // 最近 30 天每天任务量
    const byDay = await p.request().query(`
      SELECT CONVERT(NVARCHAR(10), created_at, 120) AS day,
             COUNT(*) AS cnt
      FROM task_log
      WHERE created_at >= DATEADD(DAY, -29, CAST(GETDATE() AS DATE))
      GROUP BY CONVERT(NVARCHAR(10), created_at, 120)
      ORDER BY day
    `);

    // 任务类型分布
    const byTyp = await p.request().query(`
      SELECT task_typ, COUNT(*) AS cnt
      FROM task_log
      GROUP BY task_typ
      ORDER BY cnt DESC
    `);

    // 成功 / 失败
    const byStatus = await p.request().query(`
      SELECT
        SUM(CASE WHEN resp_status = 200 THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN resp_status != 200 AND resp_status != 0 THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN resp_status = 0 THEN 1 ELSE 0 END) AS unknown,
        COUNT(*) AS total
      FROM task_log
    `);

    // 最近 20 条记录
    const recent = await p.request().query(`
      SELECT TOP 20 req_code, task_typ, position_codes, resp_status, resp_body,
             CONVERT(NVARCHAR(19), created_at, 120) AS created_at
      FROM task_log
      ORDER BY id DESC
    `);

    res.json({
      byDay: byDay.recordset,
      byTyp: byTyp.recordset,
      byStatus: byStatus.recordset[0],
      recent: recent.recordset,
    });
  } catch (err) {
    console.error("[DB] task-stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`Proxy server listening on http://localhost:${port}`),
);
