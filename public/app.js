const state = {
  problems: [],
  submissions: [],
  currentProblem: null,
  editableProblem: null,
  selectedProblemId: null,
  activeInfoTab: "description",
  lastSubmission: null,
  resultCaseIndex: 0,
  running: false
};

const statusText = {
  PENDING: "等待判题",
  RUNNING: "正在判题",
  ACCEPTED: "通过",
  WRONG_ANSWER: "答案错误",
  COMPILE_ERROR: "编译错误",
  RUNTIME_ERROR: "运行错误",
  TIME_LIMIT_EXCEEDED: "运行超时",
  MEMORY_LIMIT_EXCEEDED: "内存超限",
  SYSTEM_ERROR: "系统错误"
};

const els = {
  layout: document.querySelector(".layout"),
  refreshBtn: document.querySelector("#refreshBtn"),
  restoreSeedBtn: document.querySelector("#restoreSeedBtn"),
  toggleManagerBtn: document.querySelector("#toggleManagerBtn"),
  newProblemBtn: document.querySelector("#newProblemBtn"),
  searchInput: document.querySelector("#searchInput"),
  problemList: document.querySelector("#problemList"),
  emptyState: document.querySelector("#emptyState"),
  problemPanel: document.querySelector("#problemPanel"),
  problemMeta: document.querySelector("#problemMeta"),
  problemTitle: document.querySelector("#problemTitle"),
  problemLimits: document.querySelector("#problemLimits"),
  problemDescription: document.querySelector("#problemDescription"),
  inputDescription: document.querySelector("#inputDescription"),
  outputDescription: document.querySelector("#outputDescription"),
  constraints: document.querySelector("#constraints"),
  sampleCases: document.querySelector("#sampleCases"),
  descriptionTabBtn: document.querySelector("#descriptionTabBtn"),
  submissionsTabBtn: document.querySelector("#submissionsTabBtn"),
  solutionTabBtn: document.querySelector("#solutionTabBtn"),
  descriptionTab: document.querySelector("#descriptionTab"),
  submissionsTab: document.querySelector("#submissionsTab"),
  solutionTab: document.querySelector("#solutionTab"),
  solutionContent: document.querySelector("#solutionContent"),
  codeHighlight: document.querySelector("#codeHighlight code"),
  codeEditor: document.querySelector("#codeEditor"),
  judgeResizeHandle: document.querySelector("#judgeResizeHandle"),
  judgePanel: document.querySelector(".judge-panel"),
  resetCodeBtn: document.querySelector("#resetCodeBtn"),
  runBtn: document.querySelector("#runBtn"),
  submitBtn: document.querySelector("#submitBtn"),
  resultPanel: document.querySelector("#resultPanel"),
  refreshSubmissionsBtn: document.querySelector("#refreshSubmissionsBtn"),
  submissionList: document.querySelector("#submissionList"),
  submissionModal: document.querySelector("#submissionModal"),
  submissionModalTitle: document.querySelector("#submissionModalTitle"),
  submissionModalMeta: document.querySelector("#submissionModalMeta"),
  submissionModalBody: document.querySelector("#submissionModalBody"),
  closeSubmissionModalBtn: document.querySelector("#closeSubmissionModalBtn"),
  problemForm: document.querySelector("#problemForm"),
  formTitle: document.querySelector("#formTitle"),
  deleteProblemBtn: document.querySelector("#deleteProblemBtn"),
  closeManagerBtn: document.querySelector("#closeManagerBtn"),
  formProblemTitle: document.querySelector("#formProblemTitle"),
  formDifficulty: document.querySelector("#formDifficulty"),
  formTags: document.querySelector("#formTags"),
  formDescription: document.querySelector("#formDescription"),
  formInputDescription: document.querySelector("#formInputDescription"),
  formOutputDescription: document.querySelector("#formOutputDescription"),
  formConstraints: document.querySelector("#formConstraints"),
  formTimeLimit: document.querySelector("#formTimeLimit"),
  formMemoryLimit: document.querySelector("#formMemoryLimit"),
  formJavaTemplate: document.querySelector("#formJavaTemplate"),
  addCaseBtn: document.querySelector("#addCaseBtn"),
  testCaseList: document.querySelector("#testCaseList")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "请求失败");
  }
  return payload;
}

async function loadProblems(preferredId = state.selectedProblemId) {
  const payload = await api("/api/problems");
  state.problems = payload.problems;
  renderProblemList();
  renderInfoTabs();

  if (state.problems.length === 0) {
    clearProblemView();
    fillProblemForm(createBlankProblem());
    return;
  }

  const nextId = state.problems.some((problem) => problem.id === preferredId)
    ? preferredId
    : state.problems[0].id;
  await selectProblem(nextId);
}

function openManager() {
  els.layout.classList.remove("manager-collapsed");
  els.toggleManagerBtn.textContent = "收起管理";
}

function closeManager() {
  els.layout.classList.add("manager-collapsed");
  els.toggleManagerBtn.textContent = "题目管理";
}

function toggleManager() {
  if (els.layout.classList.contains("manager-collapsed")) {
    openManager();
  } else {
    closeManager();
  }
}

async function restoreSeedProblem() {
  const payload = await api("/api/problems/seed", {
    method: "POST",
    body: JSON.stringify({})
  });

  showToast(payload.restored ? "示例题已恢复" : "示例题已经存在");
  await loadProblems(payload.problem.id);
}

async function selectProblem(id) {
  state.selectedProblemId = id;
  const [{ problem }, editPayload] = await Promise.all([
    api(`/api/problems/${encodeURIComponent(id)}`),
    api(`/api/problems/${encodeURIComponent(id)}/edit`)
  ]);
  state.currentProblem = problem;
  state.editableProblem = editPayload.problem;
  renderProblemList();
  renderProblemView();
  fillProblemForm(state.editableProblem);
  renderSubmissionList();
}

function renderProblemList() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const filtered = state.problems.filter((problem) => {
    const haystack = `${problem.title} ${(problem.tags || []).join(" ")}`.toLowerCase();
    return haystack.includes(keyword);
  });

  els.problemList.innerHTML = filtered.map((problem) => `
    <button class="problem-item ${problem.id === state.selectedProblemId ? "active" : ""}" type="button" data-id="${escapeHtml(problem.id)}">
      <span class="problem-item-title">
        <span>${escapeHtml(problem.title)}</span>
        <span class="difficulty ${difficultyClass(problem.difficulty)}">${escapeHtml(problem.difficulty)}</span>
      </span>
      <span class="tag-line">${escapeHtml((problem.tags || []).join(" / ") || "无标签")}</span>
      <span class="tag-line">样例 ${problem.sampleCount} · 隐藏 ${problem.hiddenCount}</span>
    </button>
  `).join("");
}

function difficultyClass(difficulty) {
  if (difficulty === "困难") {
    return "hard";
  }
  if (difficulty === "中等") {
    return "medium";
  }
  return "easy";
}

function renderProblemView() {
  const problem = state.currentProblem;
  if (!problem) {
    clearProblemView();
    return;
  }

  els.emptyState.classList.add("hidden");
  els.problemPanel.classList.remove("hidden");
  els.problemMeta.textContent = `${problem.difficulty} · ${(problem.tags || []).join(" / ") || "无标签"}`;
  els.problemTitle.textContent = problem.title;
  els.problemLimits.textContent = `时间 ${problem.timeLimitMs} ms · 内存 ${problem.memoryLimitMb} MB`;
  els.problemDescription.textContent = problem.description || "暂无描述";
  els.inputDescription.textContent = problem.inputDescription || "暂无输入说明";
  els.outputDescription.textContent = problem.outputDescription || "暂无输出说明";
  els.constraints.textContent = problem.constraints || "暂无数据范围";
  els.solutionContent.textContent = "当前题目还没有解析。后续可以在题目管理中增加解析字段，或者接入大模型后自动生成解析。";
  els.sampleCases.innerHTML = problem.testCases.length
    ? problem.testCases.map((testCase, index) => `
      <div class="sample">
        <div class="sample-title">样例 ${index + 1} 输入</div>
        <pre>${escapeHtml(testCase.input)}</pre>
        <div class="sample-title">样例 ${index + 1} 输出</div>
        <pre>${escapeHtml(testCase.expectedOutput)}</pre>
      </div>
    `).join("")
    : "<p>暂无样例。</p>";

  const savedCode = localStorage.getItem(codeStorageKey(problem.id));
  els.codeEditor.value = savedCode || problem.javaTemplate || "";
  updateCodeHighlight();
  state.lastSubmission = null;
  state.resultCaseIndex = 0;
  els.resultPanel.innerHTML = '<div class="result-empty">运行样例或提交后，结果会显示在这里。</div>';
}

function renderInfoTabs() {
  const isSubmissions = state.activeInfoTab === "submissions";
  const isSolution = state.activeInfoTab === "solution";
  els.descriptionTabBtn.classList.toggle("active", !isSubmissions && !isSolution);
  els.submissionsTabBtn.classList.toggle("active", isSubmissions);
  els.solutionTabBtn.classList.toggle("active", isSolution);
  els.descriptionTab.classList.toggle("hidden", isSubmissions || isSolution);
  els.submissionsTab.classList.toggle("hidden", !isSubmissions);
  els.solutionTab.classList.toggle("hidden", !isSolution);
}

function switchInfoTab(tabName) {
  state.activeInfoTab = ["submissions", "solution"].includes(tabName) ? tabName : "description";
  renderInfoTabs();
  if (state.activeInfoTab === "submissions") {
    loadSubmissions().catch((error) => showToast(error.message));
  }
}

function clearProblemView() {
  state.currentProblem = null;
  state.editableProblem = null;
  state.selectedProblemId = null;
  state.activeInfoTab = "description";
  state.lastSubmission = null;
  state.resultCaseIndex = 0;
  els.emptyState.classList.remove("hidden");
  els.problemPanel.classList.add("hidden");
  els.resultPanel.innerHTML = "";
  renderInfoTabs();
}

function codeStorageKey(problemId) {
  return `coding-web-code-${problemId}`;
}

async function loadSubmissions() {
  const payload = await api("/api/submissions");
  state.submissions = payload.submissions || [];
  renderSubmissionList();
}

function renderSubmissionList() {
  if (!els.submissionList) {
    return;
  }

  const visibleSubmissions = state.selectedProblemId
    ? state.submissions.filter((submission) => submission.problemId === state.selectedProblemId)
    : state.submissions;

  if (visibleSubmissions.length === 0) {
    els.submissionList.innerHTML = '<div class="result-empty">当前题目暂无提交记录。运行样例或正式提交后会自动出现。</div>';
    return;
  }

  els.submissionList.innerHTML = visibleSubmissions.map((submission) => `
    <button class="submission-item" type="button" data-id="${escapeHtml(submission.id)}">
      <span>
        <span class="submission-title">
          <strong>${escapeHtml(submission.problemTitle)}</strong>
          <span class="status ${submission.status}">${statusText[submission.status] || submission.status}</span>
        </span>
        <span class="submission-meta">
          ${escapeHtml(modeText(submission.mode))} · 通过 ${submission.passedCount}/${submission.totalCount} · ${submission.timeUsedMs} ms · ${escapeHtml(formatDateTime(submission.createdAt))}
        </span>
      </span>
      <span class="case-meta">查看</span>
    </button>
  `).join("");
}

async function openSubmissionDetail(id) {
  const { submission } = await api(`/api/submissions/${encodeURIComponent(id)}`);
  const problem = state.problems.find((item) => item.id === submission.problemId);
  const problemTitle = problem ? problem.title : "已删除题目";

  els.submissionModalTitle.textContent = `${problemTitle} · ${modeText(submission.mode)}`;
  els.submissionModalMeta.textContent = `${statusText[submission.status] || submission.status} · 通过 ${submission.passedCount}/${submission.totalCount} · ${submission.timeUsedMs} ms · ${formatDateTime(submission.createdAt)}`;
  els.submissionModalBody.innerHTML = renderSubmissionDetail(submission);
  els.submissionModal.classList.remove("hidden");
}

function closeSubmissionDetail() {
  els.submissionModal.classList.add("hidden");
  els.submissionModalBody.innerHTML = "";
}

function renderSubmissionDetail(submission) {
  const rows = (submission.caseResults || []).map((result) => `
    <div class="case-result">
      <div class="result-summary">
        <span class="case-meta">用例 ${result.index}${result.isSample ? " · 样例" : " · 隐藏"} · ${result.timeUsedMs} ms</span>
        <span class="status ${result.status}">${statusText[result.status] || result.status}</span>
      </div>
      ${result.message ? `<pre>${escapeHtml(result.message)}</pre>` : ""}
      ${result.input ? `<div class="sample-title">输入</div><pre>${escapeHtml(result.input)}</pre>` : ""}
      ${result.expectedOutput ? `<div class="sample-title">期望输出</div><pre>${escapeHtml(result.expectedOutput)}</pre>` : ""}
      ${result.actualOutput ? `<div class="sample-title">实际输出</div><pre>${escapeHtml(result.actualOutput)}</pre>` : ""}
    </div>
  `).join("");

  return `
    <div class="modal-section">
      <h3>判题结果</h3>
      <div class="result-summary">
        <span class="status ${submission.status}">${statusText[submission.status] || submission.status}</span>
        <span class="case-meta">通过 ${submission.passedCount}/${submission.totalCount}</span>
      </div>
      ${submission.errorMessage ? `<pre>${escapeHtml(submission.errorMessage)}</pre>` : ""}
      ${rows || '<div class="result-empty">没有用例详情。</div>'}
    </div>
    <div class="modal-section">
      <h3>提交代码</h3>
      <pre class="submission-code">${escapeHtml(submission.code)}</pre>
    </div>
  `;
}

function modeText(mode) {
  return mode === "RUN_SAMPLE" ? "样例运行" : "正式提交";
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function fillProblemForm(problem) {
  state.editableProblem = JSON.parse(JSON.stringify(problem));
  const isNew = !problem.id;
  els.formTitle.textContent = isNew ? "新建题目" : "题目管理";
  els.deleteProblemBtn.classList.toggle("hidden", isNew);
  els.formProblemTitle.value = problem.title || "";
  els.formDifficulty.value = problem.difficulty || "简单";
  els.formTags.value = (problem.tags || []).join(",");
  els.formDescription.value = problem.description || "";
  els.formInputDescription.value = problem.inputDescription || "";
  els.formOutputDescription.value = problem.outputDescription || "";
  els.formConstraints.value = problem.constraints || "";
  els.formTimeLimit.value = problem.timeLimitMs || 2000;
  els.formMemoryLimit.value = problem.memoryLimitMb || 256;
  els.formJavaTemplate.value = problem.javaTemplate || defaultJavaTemplate();
  renderTestCaseEditor(problem.testCases || []);
}

function renderTestCaseEditor(testCases) {
  els.testCaseList.innerHTML = testCases.map((testCase, index) => `
    <div class="test-case" data-index="${index}">
      <div class="test-case-head">
        <label class="sample-toggle">
          <input type="checkbox" data-field="isSample" ${testCase.isSample ? "checked" : ""}>
          样例用例
        </label>
        <button class="danger-btn remove-case-btn" type="button">删除</button>
      </div>
      <label>
        输入
        <textarea rows="4" data-field="input" spellcheck="false">${escapeHtml(testCase.input || "")}</textarea>
      </label>
      <label>
        期望输出
        <textarea rows="4" data-field="expectedOutput" spellcheck="false">${escapeHtml(testCase.expectedOutput || "")}</textarea>
      </label>
    </div>
  `).join("");
}

function readProblemForm() {
  return {
    id: state.editableProblem?.id,
    title: els.formProblemTitle.value.trim(),
    difficulty: els.formDifficulty.value,
    tags: els.formTags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
    description: els.formDescription.value,
    inputDescription: els.formInputDescription.value,
    outputDescription: els.formOutputDescription.value,
    constraints: els.formConstraints.value,
    timeLimitMs: Number(els.formTimeLimit.value || 2000),
    memoryLimitMb: Number(els.formMemoryLimit.value || 256),
    javaTemplate: els.formJavaTemplate.value,
    testCases: Array.from(els.testCaseList.querySelectorAll(".test-case")).map((node, index) => ({
      id: state.editableProblem?.testCases?.[index]?.id,
      input: node.querySelector('[data-field="input"]').value,
      expectedOutput: node.querySelector('[data-field="expectedOutput"]').value,
      isSample: node.querySelector('[data-field="isSample"]').checked
    }))
  };
}

function createBlankProblem() {
  return {
    id: "",
    title: "",
    difficulty: "简单",
    tags: [],
    description: "",
    inputDescription: "",
    outputDescription: "",
    constraints: "",
    javaTemplate: defaultJavaTemplate(),
    timeLimitMs: 2000,
    memoryLimitMb: 256,
    testCases: [
      {
        input: "",
        expectedOutput: "",
        isSample: true
      }
    ]
  };
}

function defaultJavaTemplate() {
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

function highlightJava(code) {
  const source = String(code || "\n");
  const keywordPattern = /\b(import|package|public|private|protected|class|static|void|main|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|extends|implements|interface|enum|final|int|long|double|float|boolean|char|byte|short|String|Scanner|System)\b/;
  const tokenPattern = /(\/\/.*)|("(?:\\.|[^"\\])*")|\b\d+\b|\b(?:import|package|public|private|protected|class|static|void|main|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|extends|implements|interface|enum|final|int|long|double|float|boolean|char|byte|short|String|Scanner|System)\b/g;
  let html = "";
  let cursor = 0;
  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    html += escapeHtml(source.slice(cursor, match.index));
    const escaped = escapeHtml(token);
    if (token.startsWith("//")) {
      html += `<span class="token-comment">${escaped}</span>`;
    } else if (token.startsWith('"')) {
      html += `<span class="token-string">${escaped}</span>`;
    } else if (/^\d+$/.test(token)) {
      html += `<span class="token-number">${escaped}</span>`;
    } else if (keywordPattern.test(token)) {
      html += `<span class="token-keyword">${escaped}</span>`;
    } else {
      html += escaped;
    }
    cursor = match.index + token.length;
  }
  html += escapeHtml(source.slice(cursor));
  return html;
}

function updateCodeHighlight() {
  if (!els.codeHighlight) {
    return;
  }
  els.codeHighlight.innerHTML = highlightJava(els.codeEditor.value);
}

function syncCodeScroll() {
  const highlight = els.codeHighlight?.parentElement;
  if (!highlight) {
    return;
  }
  highlight.scrollTop = els.codeEditor.scrollTop;
  highlight.scrollLeft = els.codeEditor.scrollLeft;
}

function startJudgeResize(event) {
  if (!els.judgePanel || !els.resultPanel) {
    return;
  }
  event.preventDefault();
  const panelRect = els.judgePanel.getBoundingClientRect();
  const minCodeHeight = 180;
  const minResultHeight = 110;
  const toolbarHeight = els.judgePanel.querySelector(".editor-toolbar")?.offsetHeight || 0;
  const handleHeight = els.judgeResizeHandle?.offsetHeight || 0;
  const availableHeight = panelRect.height - toolbarHeight - handleHeight;

  function resize(moveEvent) {
    const pointerY = moveEvent.clientY ?? moveEvent.touches?.[0]?.clientY;
    if (typeof pointerY !== "number") {
      return;
    }
    const nextResultHeight = panelRect.bottom - pointerY;
    const maxResultHeight = Math.max(minResultHeight, availableHeight - minCodeHeight);
    const clampedHeight = Math.max(minResultHeight, Math.min(maxResultHeight, nextResultHeight));
    els.resultPanel.style.flexBasis = `${Math.round(clampedHeight)}px`;
    els.resultPanel.style.maxHeight = "none";
  }

  function stopResize() {
    document.body.classList.remove("is-resizing-judge");
    window.removeEventListener("pointermove", resize);
    window.removeEventListener("pointerup", stopResize);
  }

  document.body.classList.add("is-resizing-judge");
  window.addEventListener("pointermove", resize);
  window.addEventListener("pointerup", stopResize, { once: true });
}

async function saveProblem(event) {
  event.preventDefault();
  const problem = readProblemForm();
  if (!problem.title) {
    showToast("题目标题不能为空");
    return;
  }
  if (problem.testCases.length === 0) {
    showToast("至少需要一个测试用例");
    return;
  }

  const isNew = !state.editableProblem?.id;
  const payload = await api(isNew ? "/api/problems" : `/api/problems/${encodeURIComponent(state.editableProblem.id)}`, {
    method: isNew ? "POST" : "PUT",
    body: JSON.stringify(problem)
  });
  showToast("题目已保存");
  await loadProblems(payload.problem.id);
  closeManager();
}

async function deleteCurrentProblem() {
  if (!state.editableProblem?.id) {
    return;
  }
  const confirmed = confirm(`确定删除题目「${state.editableProblem.title}」吗？相关提交记录也会删除。`);
  if (!confirmed) {
    return;
  }
  await api(`/api/problems/${encodeURIComponent(state.editableProblem.id)}`, {
    method: "DELETE"
  });
  showToast("题目已删除");
  await loadProblems();
  await loadSubmissions();
}

async function runJudge(mode) {
  if (!state.currentProblem || state.running) {
    return;
  }
  state.running = true;
  setJudgeButtons(true);
  els.resultPanel.innerHTML = `<div class="result-empty">${mode === "RUN_SAMPLE" ? "正在运行样例..." : "正在提交判题..."}</div>`;

  try {
    const path = mode === "RUN_SAMPLE" ? "/api/submissions/run" : "/api/submissions/submit";
    const payload = await api(path, {
      method: "POST",
      body: JSON.stringify({
        problemId: state.currentProblem.id,
        code: els.codeEditor.value
      })
    });
    state.resultCaseIndex = 0;
    renderJudgeResult(payload.submission);
    await loadSubmissions();
  } catch (error) {
    els.resultPanel.innerHTML = `<div class="status RUNTIME_ERROR">请求失败</div><pre>${escapeHtml(error.message)}</pre>`;
  } finally {
    state.running = false;
    setJudgeButtons(false);
  }
}

function setJudgeButtons(disabled) {
  els.runBtn.disabled = disabled;
  els.submitBtn.disabled = disabled;
  els.resetCodeBtn.disabled = disabled;
}

function renderJudgeResult(submission) {
  state.lastSubmission = submission;
  const results = submission.caseResults || [];
  if (state.resultCaseIndex >= results.length) {
    state.resultCaseIndex = Math.max(results.length - 1, 0);
  }
  const currentResult = results[state.resultCaseIndex];
  const caseBlock = currentResult ? `
    <div class="case-result">
      <div class="result-summary">
        <span class="case-meta">用例 ${currentResult.index}${currentResult.isSample ? " · 样例" : " · 隐藏"} · ${currentResult.timeUsedMs} ms</span>
        <span class="status ${currentResult.status}">${statusText[currentResult.status] || currentResult.status}</span>
      </div>
      ${currentResult.message ? `<pre>${escapeHtml(currentResult.message)}</pre>` : ""}
      ${currentResult.input ? `<div class="sample-title">输入</div><pre>${escapeHtml(currentResult.input)}</pre>` : ""}
      ${currentResult.expectedOutput ? `<div class="sample-title">期望输出</div><pre>${escapeHtml(currentResult.expectedOutput)}</pre>` : ""}
      ${currentResult.actualOutput ? `<div class="sample-title">实际输出</div><pre>${escapeHtml(currentResult.actualOutput)}</pre>` : ""}
    </div>
  ` : '<div class="result-empty">没有用例详情。</div>';
  const hasMultipleCases = results.length > 1;

  els.resultPanel.innerHTML = `
    <div class="result-summary">
      <div>
        <span class="status ${submission.status}">${statusText[submission.status] || submission.status}</span>
        <span class="case-meta">通过 ${submission.passedCount}/${submission.totalCount} · 最大耗时 ${submission.timeUsedMs} ms</span>
      </div>
      <span class="case-meta">${submission.mode === "RUN_SAMPLE" ? "样例运行" : "正式提交"}</span>
    </div>
    ${submission.errorMessage ? `<pre>${escapeHtml(submission.errorMessage)}</pre>` : ""}
    ${hasMultipleCases ? `
      <div class="result-nav">
        <span class="case-meta">当前 ${state.resultCaseIndex + 1}/${results.length}</span>
        <div class="button-row">
          <button class="ghost-btn" type="button" data-result-action="prev" ${state.resultCaseIndex === 0 ? "disabled" : ""}>上一个</button>
          <button class="ghost-btn" type="button" data-result-action="next" ${state.resultCaseIndex >= results.length - 1 ? "disabled" : ""}>下一个</button>
        </div>
      </div>
    ` : ""}
    ${caseBlock}
  `;
}

function switchResultCase(direction) {
  if (!state.lastSubmission) {
    return;
  }
  const results = state.lastSubmission.caseResults || [];
  if (direction === "next") {
    state.resultCaseIndex = Math.min(state.resultCaseIndex + 1, results.length - 1);
  } else {
    state.resultCaseIndex = Math.max(state.resultCaseIndex - 1, 0);
  }
  renderJudgeResult(state.lastSubmission);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

els.problemList.addEventListener("click", (event) => {
  const button = event.target.closest(".problem-item");
  if (button) {
    selectProblem(button.dataset.id).catch((error) => showToast(error.message));
  }
});

els.searchInput.addEventListener("input", renderProblemList);
els.refreshBtn.addEventListener("click", () => loadProblems().catch((error) => showToast(error.message)));
els.restoreSeedBtn.addEventListener("click", () => restoreSeedProblem().catch((error) => showToast(error.message)));
els.refreshSubmissionsBtn.addEventListener("click", () => loadSubmissions().catch((error) => showToast(error.message)));
els.descriptionTabBtn.addEventListener("click", () => switchInfoTab("description"));
els.submissionsTabBtn.addEventListener("click", () => switchInfoTab("submissions"));
els.solutionTabBtn.addEventListener("click", () => switchInfoTab("solution"));
els.toggleManagerBtn.addEventListener("click", toggleManager);
els.newProblemBtn.addEventListener("click", () => {
  clearProblemView();
  fillProblemForm(createBlankProblem());
  openManager();
});
els.resetCodeBtn.addEventListener("click", () => {
  if (state.currentProblem) {
    els.codeEditor.value = state.currentProblem.javaTemplate || "";
    updateCodeHighlight();
    localStorage.removeItem(codeStorageKey(state.currentProblem.id));
  }
});
els.codeEditor.addEventListener("input", () => {
  updateCodeHighlight();
  if (state.currentProblem) {
    localStorage.setItem(codeStorageKey(state.currentProblem.id), els.codeEditor.value);
  }
});
els.codeEditor.addEventListener("scroll", syncCodeScroll);
els.judgeResizeHandle.addEventListener("pointerdown", startJudgeResize);
els.runBtn.addEventListener("click", () => runJudge("RUN_SAMPLE"));
els.submitBtn.addEventListener("click", () => runJudge("SUBMIT"));
els.resultPanel.addEventListener("click", (event) => {
  const button = event.target.closest("[data-result-action]");
  if (button) {
    switchResultCase(button.dataset.resultAction);
  }
});
els.problemForm.addEventListener("submit", saveProblem);
els.deleteProblemBtn.addEventListener("click", () => deleteCurrentProblem().catch((error) => showToast(error.message)));
els.closeManagerBtn.addEventListener("click", closeManager);
els.addCaseBtn.addEventListener("click", () => {
  const problem = readProblemForm();
  problem.testCases.push({
    input: "",
    expectedOutput: "",
    isSample: problem.testCases.length === 0
  });
  state.editableProblem = problem;
  renderTestCaseEditor(problem.testCases);
});
els.testCaseList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-case-btn");
  if (!button) {
    return;
  }
  const index = Number(button.closest(".test-case").dataset.index);
  const problem = readProblemForm();
  problem.testCases.splice(index, 1);
  state.editableProblem = problem;
  renderTestCaseEditor(problem.testCases);
});
els.submissionList.addEventListener("click", (event) => {
  const button = event.target.closest(".submission-item");
  if (button) {
    openSubmissionDetail(button.dataset.id).catch((error) => showToast(error.message));
  }
});
els.closeSubmissionModalBtn.addEventListener("click", closeSubmissionDetail);
els.submissionModal.addEventListener("click", (event) => {
  if (event.target === els.submissionModal) {
    closeSubmissionDetail();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.submissionModal.classList.contains("hidden")) {
    closeSubmissionDetail();
  }
});

loadProblems().catch((error) => {
  showToast(error.message);
  clearProblemView();
});
loadSubmissions().catch((error) => showToast(error.message));
closeManager();
