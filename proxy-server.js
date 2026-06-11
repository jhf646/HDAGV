const express = require("express");
const fetch = require("node-fetch");
const app = express();
const sql = require("mssql");
const path = require("path");
const fs = require("fs");

const ADDRESS_CONFIG_PATH = path.join(__dirname, "request-address-config.json");
const POSITION_CONFIG_PATH = path.join(__dirname, "position-code-config.js");

function loadAddressConfig() {
  try {
    if (!fs.existsSync(ADDRESS_CONFIG_PATH)) {
      return {};
    }
    const raw = fs.readFileSync(ADDRESS_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[CONFIG] request-address-config.json parse error:", err.message);
    return {};
  }
}

const addressConfig = loadAddressConfig();

// ── SQL Server 配置 ─────────────────────────────────────────────
const DB_NAME = "AGV_PDA_LOG";
const sqlConfig = {
  user: "sa",
  // password: "123456",
  // server: "DESKTOP-L654TSI",
 password: "Byt123",
 server: "192.168.111.70",
  database: "master", // 先连 master，建库后切换
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let pool = null;
let dbInitError = "";
let dbLastReadyAt = "";

function parsePositionCodeItemsFromConfig() {
  try {
    if (!fs.existsSync(POSITION_CONFIG_PATH)) return [];
    const text = fs.readFileSync(POSITION_CONFIG_PATH, "utf8");
    const items = [];
    const reg = /label\s*:\s*["']([^"']+)["']\s*,\s*value\s*:\s*["']([^"']+)["']\s*,\s*map\s*:\s*["']([^"']+)["']/g;
    let m;
    while ((m = reg.exec(text))) {
      const label = String(m[1] || "").trim();
      const value = String(m[2] || "").trim();
      const map = String(m[3] || "").trim();
      if (!label || !value) continue;
      items.push({ label, value, map });
    }
    return items;
  } catch (err) {
    console.error("[POSITION_CODE] parse config error:", err.message);
    return [];
  }
}

async function syncPositionCodesToDb(dbPool) {
  const rows = parsePositionCodeItemsFromConfig();
  if (!rows.length) {
    return { synced: 0 };
  }

  let synced = 0;
  for (const row of rows) {
    await dbPool
      .request()
      .input("point_code", sql.NVarChar(100), row.value)
      .input("point_name", sql.NVarChar(200), row.label)
      .input("point_map", sql.NVarChar(50), row.map || "")
      .query(`
        MERGE position_code AS t
        USING (SELECT @point_code AS point_code, @point_name AS point_name, @point_map AS point_map) AS s
        ON t.point_code = s.point_code
        WHEN MATCHED AND (ISNULL(t.point_map, '') <> ISNULL(s.point_map, '')) THEN
          UPDATE SET
            t.point_map = s.point_map,
            t.updated_at = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (point_code, point_name, point_map)
          VALUES (s.point_code, s.point_name, s.point_map);
      `);
    synced += 1;
  }
  return { synced };
}

async function rebuildPositionCodesTable(dbPool) {
  const rows = parsePositionCodeItemsFromConfig();
  if (!rows.length) {
    throw new Error("未解析到点位配置，已取消重建");
  }

  await dbPool.request().query(`
    IF OBJECT_ID(N'position_code', N'U') IS NOT NULL
      DROP TABLE position_code;

    CREATE TABLE position_code (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      point_name    NVARCHAR(200) NOT NULL,
      point_code    NVARCHAR(100) NOT NULL UNIQUE,
      point_map     NVARCHAR(50)  NOT NULL,
      is_active     BIT NOT NULL DEFAULT 0,
      created_at    DATETIME DEFAULT GETDATE(),
      updated_at    DATETIME DEFAULT GETDATE()
    )
  `);

  for (const row of rows) {
    await dbPool
      .request()
      .input("point_code", sql.NVarChar(100), row.value)
      .input("point_name", sql.NVarChar(200), row.label)
      .input("point_map", sql.NVarChar(50), row.map || "")
      .query(`
        INSERT INTO position_code (point_code, point_name, point_map, is_active)
        VALUES (@point_code, @point_name, @point_map, 0)
      `);
  }

  return { rebuilt: rows.length };
}

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

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'position_code'
    )
    CREATE TABLE position_code (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      point_name    NVARCHAR(200) NOT NULL,
      point_code    NVARCHAR(100) NOT NULL UNIQUE,
      point_map     NVARCHAR(50)  NOT NULL,
      is_active     BIT NOT NULL DEFAULT 0,
      created_at    DATETIME DEFAULT GETDATE(),
      updated_at    DATETIME DEFAULT GETDATE()
    )
  `);

  // 如已存在表则补充 is_active 列（兼容旧库）
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='position_code' AND COLUMN_NAME='is_active'
    )
    ALTER TABLE position_code ADD is_active BIT NOT NULL DEFAULT 0
  `);

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'agv_warn_log'
    )
    CREATE TABLE agv_warn_log (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      req_code      NVARCHAR(100),
      req_time      NVARCHAR(40),
      agv_code      NVARCHAR(100),
      begin_time    NVARCHAR(40),
      ed_time       NVARCHAR(40),
      main_code     NVARCHAR(100),
      main_name     NVARCHAR(200),
      sub_code      NVARCHAR(100),
      sub_name      NVARCHAR(200),
      map_code      NVARCHAR(100),
      x_pos         NVARCHAR(60),
      y_pos         NVARCHAR(60),
      raw_item      NVARCHAR(MAX),
      raw_body      NVARCHAR(MAX),
      created_at    DATETIME DEFAULT GETDATE()
    )
  `);

  const syncResult = await syncPositionCodesToDb(pool);
  console.log("[DB] position_code synced:", syncResult.synced);

  dbInitError = "";
  dbLastReadyAt = new Date().toISOString();
  console.log("[DB] Connected to", DB_NAME);
  return pool;
}

// 启动时初始化（失败不阻断代理本身）
getPool().catch((err) => {
  dbInitError = err.message;
  console.error("[DB] Init error:", err.message);
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// 添加 CORS 头，允许浏览器直接访问本地代理
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// 简单健康检查，便于跨设备确认 DB 是否连通
app.get("/api/health", async (req, res) => {
  try {
    const p = await getPool();
    await p.request().query("SELECT 1 AS ok");
    res.json({
      ok: true,
      db: {
        name: DB_NAME,
        ready: true,
        lastReadyAt: dbLastReadyAt || null,
        initError: dbInitError || null,
      },
    });
  } catch (err) {
    dbInitError = err.message;
    res.status(500).json({
      ok: false,
      db: {
        name: DB_NAME,
        ready: false,
        lastReadyAt: dbLastReadyAt || null,
        initError: dbInitError || null,
      },
      error: err.message,
    });
  }
});

// ── 点位配置：查询（点位名称/点位编号/点位地图）────────────────────
app.get("/api/position-codes", async (req, res) => {
  try {
    const p = await getPool();
    const result = await p.request().query(`
      SELECT point_name AS label, point_code AS value, point_map AS map,
             is_active,
             CONVERT(NVARCHAR(19), updated_at, 120) AS updated_at
      FROM position_code
      ORDER BY TRY_CONVERT(INT, point_code), point_code
    `);
    res.json({ ok: true, rows: result.recordset || [] });
  } catch (err) {
    console.error("[DB] get position-codes error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 点位配置：仅允许修改点位名称(label) ────────────────────────────
app.put("/api/position-codes/:value/label", async (req, res) => {
  try {
    const value = String(req.params.value || "").trim();
    const label = String((req.body || {}).label || "").trim();
    if (!value) {
      return res.status(400).json({ ok: false, error: "点位编号不能为空" });
    }
    if (!label) {
      return res.status(400).json({ ok: false, error: "点位名称不能为空" });
    }

    const p = await getPool();
    const updateResult = await p
      .request()
      .input("point_code", sql.NVarChar(100), value)
      .input("point_name", sql.NVarChar(200), label)
      .query(`
        UPDATE position_code
        SET point_name = @point_name,
            updated_at = GETDATE()
        WHERE point_code = @point_code
      `);

    if (!updateResult.rowsAffected || !updateResult.rowsAffected[0]) {
      return res.status(404).json({ ok: false, error: "点位编号不存在" });
    }

    res.json({ ok: true, value, label });
  } catch (err) {
    console.error("[DB] update position-code label error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 点位配置：切换激活状态 ────────────────────────────────────────
app.put("/api/position-codes/:value/active", async (req, res) => {
  try {
    const value = String(req.params.value || "").trim();
    const body = req.body || {};
    if (typeof body.is_active === 'undefined') {
      return res.status(400).json({ ok: false, error: "缺少 is_active 参数" });
    }
    const isActive = body.is_active ? 1 : 0;
    const p = await getPool();
    const r = await p
      .request()
      .input("point_code", sql.NVarChar(100), value)
      .input("is_active", sql.Bit, isActive)
      .query(`
        UPDATE position_code
        SET is_active = @is_active, updated_at = GETDATE()
        WHERE point_code = @point_code
      `);
    if (!r.rowsAffected || !r.rowsAffected[0]) {
      return res.status(404).json({ ok: false, error: "点位编号不存在" });
    }
    res.json({ ok: true, value, is_active: isActive });
  } catch (err) {
    console.error("[DB] update position-code active error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 点位配置：前端一键重建（按最新配置重建表+重灌数据）──────────────
app.post("/api/position-codes/rebuild", async (req, res) => {
  try {
    const p = await getPool();
    const result = await rebuildPositionCodesTable(p);
    res.json({ ok: true, rebuilt: result.rebuilt });
  } catch (err) {
    console.error("[DB] rebuild position-code table error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
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

// ── 告警推送接收（我们是接口提供方，AGV/调度系统回调）──────────────────
app.post("/service/rest/agvCallbackService/warnCallback", async (req, res) => {
  try {
    const payload = req.body || {};
    const reqCode = String(payload.reqCode || "").trim();
    const reqTime = String(payload.reqTime || "").trim();
    const data = Array.isArray(payload.data) ? payload.data : [];
    const p = await getPool();

    if (data.length === 0) {
      await p
        .request()
        .input("req_code", sql.NVarChar(100), reqCode)
        .input("req_time", sql.NVarChar(40), reqTime)
        .input("raw_body", sql.NVarChar(sql.MAX), JSON.stringify(payload || {}))
        .query(`
          INSERT INTO agv_warn_log (
            req_code, req_time, raw_body
          ) VALUES (
            @req_code, @req_time, @raw_body
          )
        `);
    } else {
      for (const item of data) {
        const row = item || {};
        await p
          .request()
          .input("req_code", sql.NVarChar(100), reqCode)
          .input("req_time", sql.NVarChar(40), reqTime)
          .input("agv_code", sql.NVarChar(100), String(row.agvCode || ""))
          .input("begin_time", sql.NVarChar(40), String(row.beginTime || ""))
          .input("ed_time", sql.NVarChar(40), String(row.edTime || ""))
          .input("main_code", sql.NVarChar(100), String(row.mainCode || ""))
          .input("main_name", sql.NVarChar(200), String(row.mainName || ""))
          .input("sub_code", sql.NVarChar(100), String(row.subCode || ""))
          .input("sub_name", sql.NVarChar(200), String(row.subName || ""))
          .input("map_code", sql.NVarChar(100), String(row.mapCode || ""))
          .input("x_pos", sql.NVarChar(60), String(row.xPos || ""))
          .input("y_pos", sql.NVarChar(60), String(row.yPox || row.yPos || ""))
          .input("raw_item", sql.NVarChar(sql.MAX), JSON.stringify(row))
          .input("raw_body", sql.NVarChar(sql.MAX), JSON.stringify(payload || {}))
          .query(`
            INSERT INTO agv_warn_log (
              req_code, req_time, agv_code, begin_time, ed_time,
              main_code, main_name, sub_code, sub_name, map_code,
              x_pos, y_pos, raw_item, raw_body
            ) VALUES (
              @req_code, @req_time, @agv_code, @begin_time, @ed_time,
              @main_code, @main_name, @sub_code, @sub_name, @map_code,
              @x_pos, @y_pos, @raw_item, @raw_body
            )
          `);
      }
    }

    // 按接口文档约定返回
    res.json({ code: "0", message: "成功" });
  } catch (err) {
    console.error("[DB] warn-callback insert error:", err.message);
    res.status(500).json({ code: "1", message: "失败: " + err.message });
  }
});

// ── 告警列表查询 ────────────────────────────────────────────────
app.get("/api/warn-log", async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const p = await getPool();
    const result = await p.request().input("limit", sql.Int, limit).query(`
      SELECT TOP (@limit)
        id,
        req_code,
        req_time,
        agv_code,
        begin_time,
        ed_time,
        main_code,
        main_name,
        sub_code,
        sub_name,
        map_code,
        x_pos,
        y_pos,
        CONVERT(NVARCHAR(19), created_at, 120) AS created_at,
        raw_item
      FROM agv_warn_log
      ORDER BY id DESC
    `);
    res.json({ ok: true, rows: result.recordset || [] });
  } catch (err) {
    console.error("[DB] warn-log query error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 防重复检查：查询最近是否已有成功任务 ─────────────────────────
app.post("/api/task-log/recent-success", async (req, res) => {
  try {
    const { taskTyp, fromCode, toCode, seconds } = req.body || {};
    const winSeconds = Number(seconds) > 0 ? Number(seconds) : 30;
    const p = await getPool();
    const result = await p
      .request()
      .input("task_typ", sql.NVarChar(50), String(taskTyp || ""))
      .input("from_code", sql.NVarChar(100), String(fromCode || ""))
      .input("to_code", sql.NVarChar(100), String(toCode || ""))
      .input("sec", sql.Int, winSeconds).query(`
        SELECT TOP 1
          CONVERT(NVARCHAR(19), created_at, 120) AS created_at,
          req_code,
          task_typ,
          JSON_VALUE(position_codes, '$[0].positionCode') AS from_code,
          JSON_VALUE(position_codes, '$[1].positionCode') AS to_code
        FROM task_log
        WHERE resp_status = 200
          AND task_typ = @task_typ
          AND JSON_VALUE(position_codes, '$[0].positionCode') = @from_code
          AND JSON_VALUE(position_codes, '$[1].positionCode') = @to_code
          AND created_at >= DATEADD(SECOND, -@sec, GETDATE())
        ORDER BY id DESC
      `);

    const row = result.recordset[0] || null;
    res.json({
      ok: true,
      exists: !!row,
      windowSeconds: winSeconds,
      row,
    });
  } catch (err) {
    console.error("[DB] recent-success check error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 防重复检查：按 position_codes 两个点位值判重 ───────────────────
app.post("/api/task-log/check-duplicate", async (req, res) => {
  try {
    const { taskTyp, fromCode, toCode, seconds } = req.body || {};
    const from = String(fromCode || "").trim();
    const to = String(toCode || "").trim();
    const typ = String(taskTyp || "").trim();
    const winSeconds = Number(seconds) > 0 ? Number(seconds) : 0;

    if (!from || !to) {
      return res.json({
        ok: true,
        exists: false,
        reason: "fromCode or toCode empty",
      });
    }

    const p = await getPool();
    const dbReq = p
      .request()
      .input("from_code", sql.NVarChar(100), from)
      .input("to_code", sql.NVarChar(100), to)
      .input("task_typ", sql.NVarChar(50), typ)
      .input("sec", sql.Int, winSeconds);

    const sqlText = `
      SELECT TOP 1
        CONVERT(NVARCHAR(19), created_at, 120) AS created_at,
        req_code,
        task_typ,
        resp_status,
        COALESCE(JSON_VALUE(position_codes, '$[0].positionCode'), JSON_VALUE(position_codes, '$[0]')) AS from_code,
        COALESCE(JSON_VALUE(position_codes, '$[1].positionCode'), JSON_VALUE(position_codes, '$[1]')) AS to_code
      FROM task_log
      WHERE COALESCE(JSON_VALUE(position_codes, '$[0].positionCode'), JSON_VALUE(position_codes, '$[0]')) = @from_code
        AND COALESCE(JSON_VALUE(position_codes, '$[1].positionCode'), JSON_VALUE(position_codes, '$[1]')) = @to_code
        AND (@task_typ = '' OR task_typ = @task_typ)
        AND (resp_status = 200 OR resp_status = 0)
        AND (@sec <= 0 OR created_at >= DATEADD(SECOND, -@sec, GETDATE()))
      ORDER BY id DESC
    `;

    const result = await dbReq.query(sqlText);
    const row = result.recordset[0] || null;

    res.json({
      ok: true,
      exists: !!row,
      windowSeconds: winSeconds,
      row,
    });
  } catch (err) {
    console.error("[DB] check-duplicate error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 站点占用检查：检查目标站点是否已有正在执行或已创建的任务 ────────
app.post("/api/task-log/check-occupancy", async (req, res) => {
  try {
    const { fromCode, toCode } = req.body || {};
    const from = String(fromCode || "").trim();
    const to = String(toCode || "").trim();

    if (!from || !to) {
      return res.json({
        ok: true,
        occupied: false,
        reason: "fromCode or toCode empty",
      });
    }

    const p = await getPool();
    
    function tryParseJson(raw, fallback = null) {
      try {
        if (raw === null || raw === undefined) return fallback;
        if (typeof raw === "object") return raw;
        return JSON.parse(String(raw));
      } catch (_) {
        return fallback;
      }
    }

    function extractCreatedTaskCode(taskRow) {
      const respBodyObj = tryParseJson(taskRow.resp_body, null);
      const rawBodyObj = tryParseJson(taskRow.raw_body, null);
      const fromResp = respBodyObj && respBodyObj.data ? String(respBodyObj.data).trim() : "";
      const fromRaw = rawBodyObj && rawBodyObj.taskCode ? String(rawBodyObj.taskCode).trim() : "";
      return fromResp || fromRaw || "";
    }

    // 查询涉及这两个站点的任务（只取本系统成功/待定响应的任务日志）
    const sqlText = `
      SELECT TOP 120
             id, req_code, task_typ, raw_body, resp_body, resp_status, position_codes,
             COALESCE(JSON_VALUE(position_codes, '$[0].positionCode'), JSON_VALUE(position_codes, '$[0]')) AS from_code,
             COALESCE(JSON_VALUE(position_codes, '$[1].positionCode'), JSON_VALUE(position_codes, '$[1]')) AS to_code
      FROM task_log
      WHERE (
        COALESCE(JSON_VALUE(position_codes, '$[0].positionCode'), JSON_VALUE(position_codes, '$[0]')) IN (@from_code, @to_code)
        OR COALESCE(JSON_VALUE(position_codes, '$[1].positionCode'), JSON_VALUE(position_codes, '$[1]')) IN (@from_code, @to_code)
      )
        AND (resp_status = 200 OR resp_status = 0)
      ORDER BY id DESC
    `;

    const result = await p
      .request()
      .input("from_code", sql.NVarChar(100), from)
      .input("to_code", sql.NVarChar(100), to)
      .query(sqlText);

    const tasks = result.recordset || [];
    
    // 批量收集候选 taskCode，避免逐条请求 queryTaskStatus 导致 5-10s 延时
    const queryUrl = "http://192.168.111.70:8182/rcms/services/rest/hikRpcService/queryTaskStatus";
    const codeMetaMap = new Map();
    const candidateTaskCodes = [];
    for (const task of tasks) {
      const taskCode = extractCreatedTaskCode(task);
      if (!taskCode || codeMetaMap.has(taskCode)) continue;
      const rawBodyObj = tryParseJson(task.raw_body, {});
      codeMetaMap.set(taskCode, {
        agvCode: String(rawBodyObj.agvCode || rawBodyObj.robotCode || "").trim(),
      });
      candidateTaskCodes.push(taskCode);
    }

    const activeStatusByTaskCode = new Map();
    const chunkSize = 30;
    for (let i = 0; i < candidateTaskCodes.length; i += chunkSize) {
      const chunk = candidateTaskCodes.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      try {
        const statusResp = await fetch(queryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeout: 5000,
          body: JSON.stringify({
            reqCode: "sys-" + Date.now() + "-" + i,
            agvCode: "",
            taskCodes: chunk,
          }),
        });
        if (!statusResp.ok) continue;
        const statusData = await statusResp.json();
        const rows = Array.isArray(statusData && statusData.data) ? statusData.data : [];
        for (const row of rows) {
          const tCode = String(row && row.taskCode ? row.taskCode : "").trim();
          const status = String(row && row.taskStatus ? row.taskStatus : "").trim();
          if (!tCode) continue;
          if (status === "1" || status === "2") {
            activeStatusByTaskCode.set(tCode, status);
          }
        }
      } catch (e) {
        console.error("[Occupancy Check] batch status query error:", e.message);
      }
    }

    // 检查任务状态：优先按 taskCode 精确判断
    let occupiedBy = null;
    const taskCodePointMap = new Map();
    for (const task of tasks) {
      const candidateTaskCode = extractCreatedTaskCode(task);
      if (!candidateTaskCode) continue;
      const blockedPoint = task.from_code === from || task.from_code === to ? task.from_code : task.to_code;
      if (!taskCodePointMap.has(candidateTaskCode)) {
        taskCodePointMap.set(candidateTaskCode, blockedPoint);
      }
      const status = activeStatusByTaskCode.get(candidateTaskCode);
      if (status !== "1" && status !== "2") continue;
      const statusLabel = status === "1" ? "已创建" : "正在执行";
      const meta = codeMetaMap.get(candidateTaskCode) || {};
      occupiedBy = {
        agvCode: String(meta.agvCode || ""),
        taskCode: candidateTaskCode,
        taskStatus: status,
        statusLabel,
        positionCode: blockedPoint,
      };
      break;
    }

    // 二级兜底：部分现场 queryTaskStatus(按taskCode) 不稳定，改按 AGV 查当前任务并反向关联 taskCode
    if (!occupiedBy) {
      const uniqueAgvs = Array.from(
        new Set(
          Array.from(codeMetaMap.values())
            .map((m) => String(m && m.agvCode ? m.agvCode : "").trim())
            .filter(Boolean),
        ),
      );

      for (const agv of uniqueAgvs) {
        try {
          const statusResp = await fetch(queryUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            timeout: 4000,
            body: JSON.stringify({
              reqCode: "sys-agv-" + Date.now() + "-" + agv,
              agvCode: agv,
              taskCodes: [""],
            }),
          });
          if (!statusResp.ok) continue;
          const statusData = await statusResp.json();
          const rows = Array.isArray(statusData && statusData.data) ? statusData.data : [];
          const current = rows[0] || null;
          if (!current) continue;

          const status = String(current.taskStatus || "").trim();
          if (status !== "1" && status !== "2") continue;

          const currentTaskCode = String(current.taskCode || "").trim();
          if (!currentTaskCode) continue;
          // 只在“当前执行任务号”属于这两个站点候选集合时拦截，避免再次误拦截
          if (!taskCodePointMap.has(currentTaskCode)) continue;

          const statusLabel = status === "1" ? "已创建" : "正在执行";
          occupiedBy = {
            agvCode: agv,
            taskCode: currentTaskCode,
            taskStatus: status,
            statusLabel,
            positionCode: String(taskCodePointMap.get(currentTaskCode) || ""),
          };
          break;
        } catch (e) {
          console.error("[Occupancy Check] AGV fallback query error for agv " + agv + ":", e.message);
        }
      }
    }

    res.json({
      ok: true,
      occupied: !!occupiedBy,
      occupiedBy: occupiedBy,
      message: occupiedBy 
        ? `站点${occupiedBy.positionCode}已有任务(${occupiedBy.taskCode})由AGV(${occupiedBy.agvCode || '-'})处于${occupiedBy.statusLabel}，请稍后重试`
        : '站点可用'
    });
  } catch (err) {
    console.error("[DB] check-occupancy error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 查询统计数据 ────────────────────────────────────────────────
app.get("/api/task-stats", async (req, res) => {
  try {
    const startDate = String((req.query || {}).startDate || "").trim();
    const endDate = String((req.query || {}).endDate || "").trim();
    const dateReg = /^\d{4}-\d{2}-\d{2}$/;
    const safeStart = dateReg.test(startDate) ? startDate : "";
    const safeEnd = dateReg.test(endDate) ? endDate : "";

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

    // 任务记录：默认当日；若传 startDate/endDate 则按日期范围查询
    let recentSql = `
      SELECT req_code, task_typ, position_codes, raw_body, resp_status, resp_body,
             CONVERT(NVARCHAR(19), created_at, 120) AS created_at
      FROM task_log
      WHERE 1=1
    `;
    const recentReq = p.request();
    if (safeStart) {
      recentSql += `\n AND created_at >= CAST(@start_date AS DATE)`;
      recentReq.input("start_date", sql.NVarChar(10), safeStart);
    }
    if (safeEnd) {
      recentSql += `\n AND created_at < DATEADD(DAY, 1, CAST(@end_date AS DATE))`;
      recentReq.input("end_date", sql.NVarChar(10), safeEnd);
    }
    if (!safeStart && !safeEnd) {
      recentSql += `\n AND created_at >= CAST(GETDATE() AS DATE)`;
      recentSql += `\n AND created_at < DATEADD(DAY, 1, CAST(GETDATE() AS DATE))`;
    }
    recentSql += `\n ORDER BY id DESC`;

    const recent = await recentReq.query(recentSql);

    res.json({
      byDay: byDay.recordset,
      byTyp: byTyp.recordset,
      byStatus: byStatus.recordset[0],
      recent: recent.recordset,
      query: {
        startDate: safeStart || null,
        endDate: safeEnd || null,
        mode: safeStart || safeEnd ? "range" : "today",
      },
    });
  } catch (err) {
    console.error("[DB] task-stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const listenPort =
  Number(process.env.PORT) || Number(addressConfig?.backend?.listenPort) || 3000;
const listenHost =
  process.env.HOST || String(addressConfig?.backend?.listenHost || "0.0.0.0");
const announceBaseUrl =
  String(addressConfig?.backend?.baseUrl || "").replace(/\/$/, "") ||
  `http://localhost:${listenPort}`;

app.listen(listenPort, listenHost, () =>
  console.log(
    `[SERVER] listening on ${listenHost}:${listenPort}, announce as ${announceBaseUrl}`,
  ),
);
