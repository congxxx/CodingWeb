const http = require("http");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

// 这些路径都从项目根目录开始拼接，避免启动命令所在位置不同导致读错文件。
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const JUDGE_DIR = path.join(ROOT_DIR, "tmp", "judge");
const SERVER_INFO_FILE = path.join(ROOT_DIR, "tmp", "server.json");

// 只监听 127.0.0.1，表示当前网站只给本机浏览器访问，适合本地开发。
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const HOST = "127.0.0.1";
const SEED_PROBLEM_ID = "seed-two-sum";

// 给用户提交加上基础限制，避免一段异常代码占满磁盘、内存或输出。
const MAX_CODE_LENGTH = 120000;
const MAX_OUTPUT_BYTES = 1024 * 1024 * 2;

// 静态文件返回给浏览器时，需要告诉浏览器文件类型。
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

async function main() {
  await ensureStorage();

  // http.createServer 是这个后端的入口。每个浏览器请求都会先进到这里。
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      const statusCode = error.statusCode || 500;
      if (!error.statusCode) {
        console.error(error);
      }
      sendJson(res, statusCode, {
        message: error.statusCode ? error.message : "服务器内部错误"
      });
    });
  });

  await listenWithFallback(server, DEFAULT_PORT, DEFAULT_PORT + 10);
}

async function ensureStorage() {
  // 第一次启动项目时自动创建必要目录和初始数据文件。
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(JUDGE_DIR, { recursive: true });
  if (!fsSync.existsSync(DB_FILE)) {
    await writeDb({
      problems: [createSeedProblem()],
      submissions: []
    });
  }
}

function createSeedProblem() {
  // 内置一道示例题，方便刚启动项目时立刻测试完整做题流程。
  const now = "2026-04-27T00:00:00.000Z";
  return {
    id: SEED_PROBLEM_ID,
    title: "两数之和",
    difficulty: "简单",
    tags: ["数组", "哈希表"],
    description: "给定一个整数数组 nums 和一个目标值 target，请输出数组中和为 target 的两个元素下标。保证每组数据只有一个答案。",
    solution: [
      "## 思路",
      "",
      "用哈希表记录每个数字之前出现的位置。",
      "",
      "遍历数组时，先计算 `target - nums[i]`，如果它已经出现过，就直接输出这两个下标。",
      "",
      "## 复杂度",
      "",
      "- 时间复杂度：`O(n)`",
      "- 空间复杂度：`O(n)`"
    ].join("\n"),
    inputDescription: "第一行输入两个整数 n 和 target。第二行输入 n 个整数，表示数组 nums。",
    outputDescription: "输出两个整数，表示满足条件的两个下标，按从小到大输出。",
    constraints: "2 <= n <= 10000，-100000 <= nums[i], target <= 100000。",
    javaTemplate: [
      "import java.util.*;",
      "",
      "public class Main {",
      "    public static void main(String[] args) {",
      "        Scanner scanner = new Scanner(System.in);",
      "        int n = scanner.nextInt();",
      "        int target = scanner.nextInt();",
      "        int[] nums = new int[n];",
      "        for (int i = 0; i < n; i++) {",
      "            nums[i] = scanner.nextInt();",
      "        }",
      "",
      "        Map<Integer, Integer> seen = new HashMap<>();",
      "        for (int i = 0; i < n; i++) {",
      "            int need = target - nums[i];",
      "            if (seen.containsKey(need)) {",
      "                int a = seen.get(need);",
      "                int b = i;",
      "                System.out.println(Math.min(a, b) + \" \" + Math.max(a, b));",
      "                return;",
      "            }",
      "            seen.put(nums[i], i);",
      "        }",
      "    }",
      "}"
    ].join("\n"),
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    testCases: [
      {
        id: "seed-case-1",
        input: "4 9\n2 7 11 15\n",
        expectedOutput: "0 1\n",
        isSample: true,
        sortOrder: 1
      },
      {
        id: "seed-case-2",
        input: "3 6\n3 2 4\n",
        expectedOutput: "1 2\n",
        isSample: true,
        sortOrder: 2
      },
      {
        id: "seed-case-3",
        input: "2 6\n3 3\n",
        expectedOutput: "0 1\n",
        isSample: false,
        sortOrder: 3
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  // 约定所有后端接口都以 /api/ 开头，其余请求都当作前端静态文件处理。
  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname);
    return;
  }

  await serveStatic(res, pathname);
}

async function handleApi(req, res, pathname) {
  // 题目列表：只返回列表页需要的信息，不返回完整题面和隐藏用例。
  if (req.method === "GET" && pathname === "/api/problems") {
    const db = await readDb();
    sendJson(res, 200, {
      problems: db.problems.map((problem) => toProblemListItem(problem))
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/problems/seed") {
    // 恢复示例题：用户误删示例题后，可以不用手动修改 data/db.json。
    const db = await readDb();
    const existing = db.problems.find((problem) => problem.id === SEED_PROBLEM_ID || problem.title === "两数之和");
    if (existing) {
      sendJson(res, 200, { problem: toEditableProblem(existing), restored: false });
      return;
    }

    const problem = createSeedProblem();
    db.problems.unshift(problem);
    await writeDb(db);
    sendJson(res, 201, { problem: toEditableProblem(problem), restored: true });
    return;
  }

  // 新建题目：前端表单提交后，会在这里生成题目 ID 并写入 data/db.json。
  if (req.method === "POST" && pathname === "/api/problems") {
    const payload = await readJsonBody(req);
    const db = await readDb();
    const problem = normalizeProblemPayload(payload);
    db.problems.unshift(problem);
    await writeDb(db);
    sendJson(res, 201, { problem: toEditableProblem(problem) });
    return;
  }

  const problemEditMatch = pathname.match(/^\/api\/problems\/([^/]+)\/edit$/);
  if (req.method === "GET" && problemEditMatch) {
    // 编辑接口会返回完整测试用例，包括隐藏用例。真实项目里这里需要管理员权限。
    const problem = await findProblemOrFail(problemEditMatch[1]);
    sendJson(res, 200, { problem: toEditableProblem(problem) });
    return;
  }

  const problemMatch = pathname.match(/^\/api\/problems\/([^/]+)$/);
  if (problemMatch) {
    const id = problemMatch[1];

    if (req.method === "GET") {
      // 做题详情接口只返回样例用例，避免隐藏测试用例泄露给做题页面。
      const problem = await findProblemOrFail(id);
      sendJson(res, 200, { problem: toPublicProblem(problem) });
      return;
    }

    if (req.method === "PUT") {
      // 更新题目时保留原 ID 和创建时间，只刷新题目内容与更新时间。
      const payload = await readJsonBody(req);
      const db = await readDb();
      const index = db.problems.findIndex((problem) => problem.id === id);
      if (index === -1) {
        sendJson(res, 404, { message: "题目不存在" });
        return;
      }
      db.problems[index] = normalizeProblemPayload(payload, db.problems[index]);
      await writeDb(db);
      sendJson(res, 200, { problem: toEditableProblem(db.problems[index]) });
      return;
    }

    if (req.method === "DELETE") {
      // 删除题目时，同时删除这个题目的提交记录，避免留下无效历史数据。
      const db = await readDb();
      const nextProblems = db.problems.filter((problem) => problem.id !== id);
      if (nextProblems.length === db.problems.length) {
        sendJson(res, 404, { message: "题目不存在" });
        return;
      }
      db.problems = nextProblems;
      db.submissions = db.submissions.filter((submission) => submission.problemId !== id);
      await writeDb(db);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  if (req.method === "POST" && pathname === "/api/submissions/run") {
    // 运行样例：只拿样例用例判题，适合用户边写边调试。
    const payload = await readJsonBody(req);
    const result = await runSubmission(payload);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && pathname === "/api/submissions/submit") {
    // 正式提交：使用样例和隐藏用例一起判题，但隐藏用例内容不会返回给前端。
    const payload = await readJsonBody(req);
    const result = await createSubmission(payload);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && pathname === "/api/submissions") {
    // 提交列表只展示摘要，避免列表页一次性返回大量代码内容。
    const db = await readDb();
    const problemTitleById = new Map(db.problems.map((problem) => [problem.id, problem.title]));
    sendJson(res, 200, {
      submissions: db.submissions
        .filter((submission) => submission.mode === "SUBMIT")
        .slice()
        .reverse()
        .map((submission) => ({
          id: submission.id,
          problemId: submission.problemId,
          problemTitle: problemTitleById.get(submission.problemId) || "已删除题目",
          mode: submission.mode,
          status: submission.status,
          passedCount: submission.passedCount,
          totalCount: submission.totalCount,
          timeUsedMs: submission.timeUsedMs,
          createdAt: submission.createdAt
        }))
    });
    return;
  }

  const submissionMatch = pathname.match(/^\/api\/submissions\/([^/]+)$/);
  if (req.method === "GET" && submissionMatch) {
    // 提交详情用于查看单次提交的完整代码和判题结果。
    const db = await readDb();
    const submission = db.submissions.find((item) => item.id === submissionMatch[1]);
    if (!submission) {
      sendJson(res, 404, { message: "提交记录不存在" });
      return;
    }
    sendJson(res, 200, { submission });
    return;
  }

  sendJson(res, 404, { message: "接口不存在" });
}

async function prepareSubmission(payload, mode) {
  // 这里负责把一次“运行样例”或“正式提交”转换成统一判题结果。
  const problemId = String(payload.problemId || "");
  const code = String(payload.code || "");
  if (!problemId) {
    throw createHttpError(400, "缺少题目 ID");
  }
  if (!code.trim()) {
    throw createHttpError(400, "代码不能为空");
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw createHttpError(400, "代码长度超过限制");
  }

  const db = await readDb();
  const problem = db.problems.find((item) => item.id === problemId);
  if (!problem) {
    throw createHttpError(404, "题目不存在");
  }

  const cases = mode === "RUN_SAMPLE"
    ? problem.testCases.filter((testCase) => testCase.isSample)
    : problem.testCases;

  if (cases.length === 0) {
    throw createHttpError(400, mode === "RUN_SAMPLE" ? "该题还没有样例用例" : "该题还没有测试用例");
  }

  const judgeResult = await judgeJava(problem, code, cases, mode);
  const now = new Date().toISOString();

  return {
    problem,
    submission: {
    problemId: problem.id,
    code,
    language: "JAVA",
    mode,
    status: judgeResult.status,
    passedCount: judgeResult.passedCount,
    totalCount: judgeResult.totalCount,
    timeUsedMs: judgeResult.timeUsedMs,
    memoryUsedMb: null,
    errorMessage: judgeResult.errorMessage,
    caseResults: judgeResult.caseResults,
    createdAt: now,
    updatedAt: now
    }
  };
}

async function runSubmission(payload) {
  // 运行样例只返回结果，不写入提交记录。
  const { submission } = await prepareSubmission(payload, "RUN_SAMPLE");
  return { submission };
}

async function createSubmission(payload) {
  // 正式提交会写入历史记录，供后续查看。
  const { submission } = await prepareSubmission(payload, "SUBMIT");
  submission.id = crypto.randomUUID();

  const db = await readDb();
  db.submissions.push(submission);
  await writeDb(db);
  return { submission };
}

async function judgeJava(problem, code, cases, mode) {
  // 当前 MVP 直接调用本机 javac/java。正式上线前应替换为 Docker 隔离判题。
  const guardMessage = validateJavaCode(code);
  if (guardMessage) {
    return {
      status: "COMPILE_ERROR",
      passedCount: 0,
      totalCount: cases.length,
      timeUsedMs: 0,
      errorMessage: guardMessage,
      caseResults: []
    };
  }

  const runId = crypto.randomUUID();
  const workDir = path.join(JUDGE_DIR, runId);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // 每次判题都使用独立临时目录，避免不同用户或不同提交之间互相影响。
    await fs.writeFile(path.join(workDir, "Main.java"), code, "utf8");

    // 第一步：先编译 Main.java。编译失败时不再运行测试用例。
    const compile = await runProcess("javac", ["-encoding", "UTF-8", "Main.java"], {
      cwd: workDir,
      timeoutMs: 5000,
      input: ""
    });

    if (compile.timedOut) {
      return {
        status: "COMPILE_ERROR",
        passedCount: 0,
        totalCount: cases.length,
        timeUsedMs: compile.durationMs,
        errorMessage: "编译超时",
        caseResults: []
      };
    }

    if (compile.exitCode !== 0) {
      return {
        status: "COMPILE_ERROR",
        passedCount: 0,
        totalCount: cases.length,
        timeUsedMs: compile.durationMs,
        errorMessage: truncateOutput(compile.stderr || compile.stdout || "编译失败"),
        caseResults: []
      };
    }

    const caseResults = [];
    let passedCount = 0;
    let maxTime = 0;

    for (let index = 0; index < cases.length; index += 1) {
      const testCase = cases[index];

      // 第二步：编译成功后，每个测试用例单独运行一次 java Main。
      const run = await runProcess("java", [`-Xmx${problem.memoryLimitMb || 256}m`, "Main"], {
        cwd: workDir,
        timeoutMs: problem.timeLimitMs || 2000,
        input: testCase.input || ""
      });
      maxTime = Math.max(maxTime, run.durationMs);

      if (run.timedOut) {
        const result = buildCaseResult(testCase, index, "TIME_LIMIT_EXCEEDED", run, mode, "运行超时");
        caseResults.push(result);
        return finalizeJudge("TIME_LIMIT_EXCEEDED", passedCount, cases.length, maxTime, "运行超时", caseResults);
      }

      if (run.outputOverflow) {
        const result = buildCaseResult(testCase, index, "RUNTIME_ERROR", run, mode, "输出超过限制");
        caseResults.push(result);
        return finalizeJudge("RUNTIME_ERROR", passedCount, cases.length, maxTime, "输出超过限制", caseResults);
      }

      if (run.exitCode !== 0) {
        const message = truncateOutput(run.stderr || "运行错误");
        const result = buildCaseResult(testCase, index, "RUNTIME_ERROR", run, mode, message);
        caseResults.push(result);
        return finalizeJudge("RUNTIME_ERROR", passedCount, cases.length, maxTime, message, caseResults);
      }

      // 输出比较是判题核心：程序实际输出和题目期望输出一致才算通过。
      const accepted = normalizeOutput(run.stdout) === normalizeOutput(testCase.expectedOutput || "");
      if (!accepted) {
        const result = buildCaseResult(testCase, index, "WRONG_ANSWER", run, mode, "答案错误");
        caseResults.push(result);
        return finalizeJudge("WRONG_ANSWER", passedCount, cases.length, maxTime, "答案错误", caseResults);
      }

      passedCount += 1;
      caseResults.push(buildCaseResult(testCase, index, "ACCEPTED", run, mode, ""));
    }

    return finalizeJudge("ACCEPTED", passedCount, cases.length, maxTime, "", caseResults);
  } finally {
    // 无论判题成功还是失败，都清理临时目录，避免 tmp 目录越来越大。
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

function validateJavaCode(code) {
  // 这是 MVP 阶段的基础保护，不等于真正安全隔离。真正安全仍需要 Docker。
  if (!/\bpublic\s+class\s+Main\b/.test(code)) {
    return "Java 代码必须包含 public class Main";
  }

  const blockedPatterns = [
    { pattern: /\bRuntime\b|\bProcessBuilder\b|\.exec\s*\(/, reason: "暂不允许创建系统进程" },
    { pattern: /\bSystem\s*\.\s*exit\s*\(/, reason: "暂不允许调用 System.exit" },
    { pattern: /\bSocket\b|\bServerSocket\b|\bURLClassLoader\b/, reason: "暂不允许访问网络或动态加载类" },
    { pattern: /\bFileInputStream\b|\bFileOutputStream\b|\bRandomAccessFile\b|\bFiles\b|\bPaths\b/, reason: "暂不允许访问本机文件" }
  ];

  const blocked = blockedPatterns.find((item) => item.pattern.test(code));
  return blocked ? blocked.reason : "";
}

function finalizeJudge(status, passedCount, totalCount, timeUsedMs, errorMessage, caseResults) {
  // 统一整理判题返回结构，前端只需要按这一种格式渲染结果。
  return {
    status,
    passedCount,
    totalCount,
    timeUsedMs,
    errorMessage,
    caseResults
  };
}

function buildCaseResult(testCase, index, status, run, mode, message) {
  // 隐藏用例只返回状态，不返回输入输出，避免用户通过提交结果反推出测试数据。
  const canShowContent = mode === "RUN_SAMPLE" || testCase.isSample;
  return {
    index: index + 1,
    isSample: Boolean(testCase.isSample),
    status,
    timeUsedMs: run.durationMs,
    message,
    input: canShowContent ? testCase.input : "",
    expectedOutput: canShowContent ? testCase.expectedOutput : "",
    actualOutput: canShowContent ? truncateOutput(run.stdout) : ""
  };
}

function runProcess(command, args, options) {
  // 把“运行一个外部命令”封装起来。这里会记录输出、耗时，并处理超时。
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputOverflow = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    // 超过限制时间后杀掉子进程，避免用户代码无限循环。
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.stdout.on("data", (chunk) => {
      // 用户代码如果疯狂输出，也会消耗内存，所以这里限制最大输出大小。
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        outputOverflow = true;
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      // 标准错误也算输出，例如 Java 异常栈信息同样需要限制大小。
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        outputOverflow = true;
        child.kill("SIGKILL");
        return;
      }
      stderr += chunk.toString("utf8");
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
        outputOverflow,
        durationMs: Date.now() - startedAt
      });
    });

    child.stdin.end(options.input || "");
  });
}

function normalizeOutput(value) {
  // 力扣类判题通常会忽略行尾空格和末尾多余换行，这里也采用这个规则。
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

function truncateOutput(value) {
  // 错误信息太长会影响页面阅读，所以只截取前面一部分展示。
  const text = String(value || "");
  return text.length > 4000 ? `${text.slice(0, 4000)}\n...输出已截断` : text;
}

function normalizeProblemPayload(payload, existing = {}) {
  // 前端传来的表单数据不一定完全可靠，进入数据库前先统一清洗和补默认值。
  const now = new Date().toISOString();
  const title = String(payload.title || "").trim();
  if (!title) {
    throw createHttpError(400, "题目标题不能为空");
  }

  const tags = Array.isArray(payload.tags)
    ? payload.tags
    : String(payload.tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

  const testCases = Array.isArray(payload.testCases)
    ? payload.testCases.map((testCase, index) => ({
      id: testCase.id || crypto.randomUUID(),
      input: String(testCase.input || ""),
      expectedOutput: String(testCase.expectedOutput || ""),
      isSample: Boolean(testCase.isSample),
      sortOrder: index + 1
    }))
    : existing.testCases || [];

  return {
    id: existing.id || crypto.randomUUID(),
    title,
    difficulty: ["简单", "中等", "困难"].includes(payload.difficulty) ? payload.difficulty : "简单",
    tags,
    description: String(payload.description || ""),
    solution: String(payload.solution || ""),
    inputDescription: String(payload.inputDescription || ""),
    outputDescription: String(payload.outputDescription || ""),
    constraints: String(payload.constraints || ""),
    javaTemplate: String(payload.javaTemplate || defaultJavaTemplate()),
    timeLimitMs: clampNumber(payload.timeLimitMs, 500, 10000, 2000),
    memoryLimitMb: clampNumber(payload.memoryLimitMb, 64, 1024, 256),
    testCases,
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function defaultJavaTemplate() {
  // 新建题目时默认给一个最基础的 Java Main 模板。
  return [
    "import java.util.*;",
    "",
    "public class Main {",
    "    public static void main(String[] args) {",
    "        Scanner scanner = new Scanner(System.in);",
    "        // 在这里编写代码",
    "    }",
    "}"
  ].join("\n");
}

function clampNumber(value, min, max, fallback) {
  // 限制数字范围，避免题目配置出过小或过大的时间/内存限制。
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function toProblemListItem(problem) {
  // 列表页只需要摘要信息，减少接口返回内容。
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    tags: problem.tags || [],
    sampleCount: problem.testCases.filter((testCase) => testCase.isSample).length,
    hiddenCount: problem.testCases.filter((testCase) => !testCase.isSample).length,
    updatedAt: problem.updatedAt
  };
}

function toPublicProblem(problem) {
  // 做题页不能拿到隐藏测试用例，只能拿到样例。
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    tags: problem.tags || [],
    description: problem.description,
    solution: problem.solution || "",
    inputDescription: problem.inputDescription,
    outputDescription: problem.outputDescription,
    constraints: problem.constraints,
    javaTemplate: problem.javaTemplate,
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    testCases: problem.testCases
      .filter((testCase) => testCase.isSample)
      .map((testCase) => ({
        id: testCase.id,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        isSample: true,
        sortOrder: testCase.sortOrder
      }))
  };
}

function toEditableProblem(problem) {
  // 编辑页需要完整题目数据。这里深拷贝一下，避免后续误改原对象。
  return JSON.parse(JSON.stringify(problem));
}

async function findProblemOrFail(id) {
  // 常用的小工具：根据 ID 找题目，找不到就抛出 404 错误。
  const db = await readDb();
  const problem = db.problems.find((item) => item.id === id);
  if (!problem) {
    throw createHttpError(404, "题目不存在");
  }
  return problem;
}

async function readDb() {
  // MVP 阶段用 JSON 文件临时代替数据库。
  const raw = await fs.readFile(DB_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeDb(db) {
  // 每次写入都格式化 JSON，方便人直接打开 data/db.json 查看。
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

async function readJsonBody(req) {
  // 读取 POST/PUT 请求体，并把 JSON 字符串转换成 JavaScript 对象。
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024 * 4) {
      throw createHttpError(413, "请求体过大");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw createHttpError(400, "JSON 格式错误");
  }
}

async function serveStatic(res, pathname) {
  // 负责把 public 目录里的 HTML/CSS/JS 文件返回给浏览器。
  const safePathname = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    // 防止通过类似 ../ 的路径访问 public 目录外的文件。
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendText(res, 404, "Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fsSync.createReadStream(filePath).pipe(res);
  } catch (error) {
    sendText(res, 404, "Not Found");
  }
}

function sendJson(res, statusCode, payload) {
  // API 接口统一用 JSON 返回。
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  // 静态文件错误这类简单响应，用纯文本即可。
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function createHttpError(statusCode, message) {
  // 给错误对象挂上 HTTP 状态码，统一交给 main 里的错误处理返回给前端。
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function listenWithFallback(server, port, maxPort) {
  // 如果默认端口 3000 被占用，就继续尝试 3001、3002，直到 3010。
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, HOST);
    });
    const url = `http://${HOST}:${port}`;
    await fs.mkdir(path.dirname(SERVER_INFO_FILE), { recursive: true });
    await fs.writeFile(SERVER_INFO_FILE, JSON.stringify({ url, port, pid: process.pid }, null, 2), "utf8");
    console.log(`CodingWeb MVP started at ${url}`);
  } catch (error) {
    server.removeAllListeners("error");
    if (error.code === "EADDRINUSE" && port < maxPort) {
      await listenWithFallback(server, port + 1, maxPort);
      return;
    }
    throw error;
  }
}

process.on("uncaughtException", (error) => {
  if (error.statusCode) {
    return;
  }
  console.error(error);
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
